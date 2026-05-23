import makeWASocket, {
    DisconnectReason,
    initAuthCreds,
    BufferJSON,
    type WASocket,
    type ConnectionState,
    type AuthenticationState
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { prisma } from '../lib/prisma';

// Objeto global na memória para manter as sessões ativas e seus estados
const instanciasAtivas: { [key: string]: WASocket } = {};

// Dicionário global para guardar os QR Codes em tempo real na memória para o Front buscar
const qrCodesAtivos: { [key: string]: string } = {};

// Dicionário para rastrear o status textual da conexão ('CONNECTING', 'OPEN', 'QRCODE', 'CLOSED')
const statusConexoes: { [key: string]: 'CONNECTING' | 'OPEN' | 'QRCODE' | 'CLOSED' } = {};

export class WhatsAppService {

    /**
     * 🟢 ADAPTADOR DE ESTADO: Lê e grava as credenciais direto no banco de dados (Opção A)
     */
    private static async usePrismaAuthState(userId: string): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> {
        // 1. Busca a sessão atual no banco de dados
        const sessao = await prisma.whatsappSession.findUnique({
            where: { userId }
        });

        // 2. Recupera e reconverte as credenciais do banco se existirem, caso contrário inicia do zero
        let creds = initAuthCreds();
        if (sessao?.sessionData) {
            try {
                creds = JSON.parse(sessao.sessionData, BufferJSON.reviver);
            } catch (e) {
                console.error(`❌ Erro ao decodificar sessionData do banco para o usuário ${userId}:`, e);
            }
        }

        return {
            state: {
                creds,
                // O Baileys usa chaves dinâmicas além das credenciais básicas. 
                // Como salvamos tudo unificado na string, o keys gerencia o estado na memória enquanto roda.
                keys: {
                    get: (type, ids) => ids.reduce((dict, id) => ({ ...dict, [id]: undefined }), {}),
                    set: () => { } // Modificações maiores de chaves são tratadas nativamente por gatilhos do Baileys
                }
            },
            // 3. Função mágica acionada toda vez que o token muda (grava no banco em tempo real)
            saveCreds: async () => {
                const sessionDataString = JSON.stringify(creds, BufferJSON.replacer);
                await prisma.whatsappSession.update({
                    where: { userId },
                    data: { sessionData: sessionDataString }
                });
            }
        };
    }

    /**
     * 1. LIGA O MOTOR: Inicializa ou restabelece a conexão do Baileys para o usuário.
     */
    static async conectarWhatsApp(userId: string): Promise<void> {
        console.log(`\n==================================================`);
        console.log(`🔍 [WhatsAppService] Iniciando motor para o ID: "${userId}"`);
        console.log(`==================================================`);

        try {
            statusConexoes[userId] = 'CONNECTING';

            // Busca ou cria a sessão no banco garantindo a compatibilidade com o novo Schema
            let sessao = await prisma.whatsappSession.findUnique({
                where: { userId },
                include: { user: true }
            });

            if (!sessao) {
                console.log(`⚠️ Sessão não encontrada. Criando registro automático no banco...`);
                const pastaPadrao = `auth_${userId}`;
                sessao = await prisma.whatsappSession.create({
                    data: {
                        userId,
                        pastaAuth: pastaPadrao,
                        status: 'CONNECTING'
                    },
                    include: { user: true }
                });
            }

            const nomeUsuario = sessao.user?.nome || "Usuário";
            const { pastaAuth } = sessao;

            // Evita duplicar conexão se o socket já estiver ativo na RAM
            if (instanciasAtivas[pastaAuth]) {
                console.log(`➔ [${nomeUsuario}] WhatsApp já está ativo na memória.`);
                statusConexoes[userId] = 'OPEN';
                return;
            }

            // 🟢 AGORA LÊ DIRETO DO BANCO DE DADOS (Substituído useMultiFileAuthState)
            const { state, saveCreds } = await this.usePrismaAuthState(userId);

            // Cria o Socket do Baileys
            const sock = makeWASocket({
                auth: state,
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false
            });

            // Salva a instância na memória RAM global
            instanciasAtivas[pastaAuth] = sock;

            // Escuta as atualizações de conexão
            sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    console.log(`✨ [QR CODE] Novo código gerado para o usuário: ${nomeUsuario}`);
                    qrCodesAtivos[userId] = qr;
                    statusConexoes[userId] = 'QRCODE';
                    
                    await prisma.whatsappSession.update({
                        where: { userId },
                        data: { status: 'QRCODE' }
                    });
                }

                if (connection === 'close') {
                    const erroStatusCode = (lastDisconnect?.error as any)?.output?.statusCode;
                    const deveReconectar = erroStatusCode !== DisconnectReason.loggedOut && erroStatusCode !== 403;

                    console.log(`\n❌ [CONEXÃO] [${nomeUsuario}] Conexão fechada. Status: ${erroStatusCode}`);
                    statusConexoes[userId] = 'CLOSED';
                    
                    // Atualiza o status no banco de dados
                    await prisma.whatsappSession.update({
                        where: { userId },
                        data: { status: 'CLOSED' }
                    });

                    // Se foi o próprio usuário que desconectou pelo celular, limpa o token do banco
                    if (erroStatusCode === DisconnectReason.loggedOut) {
                        console.log(`🗑️ [${nomeUsuario}] Desconectado pelo celular. Limpando chaves do banco...`);
                        await prisma.whatsappSession.update({
                            where: { userId },
                            data: { sessionData: null }
                        });
                    }

                    // Limpa rastros da memória
                    delete instanciasAtivas[pastaAuth];
                    delete qrCodesAtivos[userId];

                    if (deveReconectar) {
                        console.log(`⏳ Reconectando automaticamente em 5 segundos...`);
                        setTimeout(() => this.conectarWhatsApp(userId), 5000);
                    }
                } 
                else if (connection === 'open') {
                    console.log(`\n✅ [${nomeUsuario}] WHATSAPP CONECTADO COM SUCESSO!`);
                    statusConexoes[userId] = 'OPEN';
                    delete qrCodesAtivos[userId];
                    
                    // Salva o status de conectado no banco de dados
                    await prisma.whatsappSession.update({
                        where: { userId },
                        data: { status: 'OPEN' }
                    });
                }
            });

            // Escuta a geração de novas chaves e salva diretamente no PostgreSQL
            sock.ev.on('creds.update', saveCreds);

        } catch (error) {
            statusConexoes[userId] = 'CLOSED';
            console.error(`💥 Erro crítico no motor do WhatsApp para o usuário ${userId}:`, error);
        }
    }

    /**
     * 2. BUSCA O STATUS E O QR CODE ATUAL (Para o seu Front-end bater via GET)
     */
    static async getStatus(userId: string) {
        const sessao = await prisma.whatsappSession.findUnique({ where: { userId } });
        const pastaAuth = sessao?.pastaAuth || `auth_${userId}`;
        
        const estaNaRam = !!instanciasAtivas[pastaAuth];
        // Sincroniza o status vindo da RAM ou do banco
        const statusAtual = statusConexoes[userId] || sessao?.status || (estaNaRam ? 'OPEN' : 'CLOSED');
        const qrCodeString = qrCodesAtivos[userId] || null;

        return {
            userId,
            status: statusAtual,
            qrCode: qrCodeString,
            conectado: statusAtual === 'OPEN'
        };
    }

    /**
     * 3. DISPARA MENSAGEM (Sua rota POST de envio vai chamar este método)
     */
    static async sendMessage(userId: string, toNumber: string, messageText: string): Promise<boolean> {
        console.log(`\n✉️ [Disparo] Tentando enviar mensagem para o número: ${toNumber}`);
        try {
            const sessao = await prisma.whatsappSession.findUnique({
                where: { userId }
            });

            if (!sessao) {
                throw new Error('Usuário não possui registro de sessão configurado no banco.');
            }

            const { pastaAuth } = sessao;
            const clientSock = instanciasAtivas[pastaAuth];

            if (!clientSock) {
                throw new Error('O WhatsApp deste usuário não está inicializado ou ativo na memória.');
            }

            // Remove tudo o que não for número
            const apenasNumeros = toNumber.replace(/\D/g, '');
            if (!apenasNumeros) {
                throw new Error('O número fornecido é inválido.');
            }

            console.log(`📡 [DEBUG-DISPARO] Verificando existência e formato do JID para: ${apenasNumeros}...`);
            const [resultadoValidacao] = (await clientSock.onWhatsApp(apenasNumeros)) || [];

            if (!resultadoValidacao || !resultadoValidacao.exists) {
                throw new Error('Este número não possui uma conta de WhatsApp ativa.');
            }

            const jidReal = resultadoValidacao.jid;
            
            // Dispara o texto
            await clientSock.sendMessage(jidReal, { text: messageText });
            console.log(`✅ Mensagem enviada com sucesso para o JID: ${jidReal}`);
            return true;

        } catch (error: any) {
            console.error(`❌ Falha no envio da mensagem:`, error.message || error);
            throw error;
        }
    }
    /**
     * 4. DESCONECTA O WHATSAPP: Encerra a sessão atual e limpa os dados do banco de dados.
     * Chamado quando o usuário clica em "Desconectar" ou "Sair" na interface do Front-end.
     */
    static async desconectarWhatsApp(userId: string): Promise<boolean> {
        console.log(`\n📴 [WhatsAppService] Solicitando desconexão para o usuário: "${userId}"`);
        
        try {
            // 1. Busca os dados da sessão no banco de dados
            const sessao = await prisma.whatsappSession.findUnique({
                where: { userId }
            });

            if (!sessao) {
                throw new Error('Sessão não encontrada no banco de dados.');
            }

            const { pastaAuth } = sessao;
            const clientSock = instanciasAtivas[pastaAuth];

            // 2. Se a instância estiver rodando na memória RAM, desconecta o socket nativamente
            if (clientSock) {
                try {
                    console.log(`➔ Encerrando socket ativo na memória para [${pastaAuth}]...`);
                    // logout() avisa os servidores do WhatsApp que este aparelho está saindo voluntariamente
                    await clientSock.logout(); 
                    clientSock.end(undefined);
                } catch (err) {
                    console.log(`⚠️ Aviso ao fechar socket (pode ser que já estivesse offline):`, err);
                }
            }

            // 3. Limpa as variáveis globais de cache na memória RAM
            delete instanciasAtivas[pastaAuth];
            delete qrCodesAtivos[userId];
            statusConexoes[userId] = 'CLOSED';

            // 4. Reseta as informações no banco de dados PostgreSQL
            await prisma.whatsappSession.update({
                where: { userId },
                data: {
                    sessionData: null,  // Apaga as chaves criptográficas antigas
                    status: 'CLOSED'    // Define o status como fechado
                }
            });

            console.log(`✅ [${pastaAuth}] Desconectado e limpo com sucesso!`);
            return true;

        } catch (error: any) {
            console.error(`❌ Erro ao desconectar o WhatsApp do usuário ${userId}:`, error.message || error);
            throw error;
        }
    }
}