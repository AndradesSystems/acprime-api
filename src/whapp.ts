import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    type WASocket,
    type ConnectionState
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal'; // Biblioteca para forçar a renderização do QR no terminal
import { prisma } from './lib/prisma';

// Objeto global na memória para manter as sessões ativas
const instanciasAtivas: { [key: string]: WASocket } = {};

/**
 * LIGA O MOTOR: Inicializa o WhatsApp e força o desenho do QR Code no terminal.
 */
export async function conectarWhatsApp(userId: string): Promise<void> {
    console.log(`\n==================================================`);
    console.log(`🔍 [DEBUG-START] Iniciando conectarWhatsApp para o ID: "${userId}"`);
    console.log(`==================================================`);

    try {
        console.log(`⚙️ [DEBUG-BANCO] Buscando sessão no Prisma para o userId: ${userId}...`);
        let sessao = await prisma.whatsappSession.findUnique({
            where: { userId },
            include: { user: true }
        });

        if (!sessao) {
            console.log(`⚠️ [DEBUG-BANCO] Sessão NÃO encontrada no banco para o ID: ${userId}`);
            console.log(`📥 [DEBUG-BANCO] Criando registro de sessão automático para evitar bloqueios...`);
            
            const pastaPadrao = `auth_${userId}`;
            sessao = await prisma.whatsappSession.create({
                data: {
                    userId,
                    pastaAuth: pastaPadrao,
                    numeroDestino: "0000000000000",
                    mensagem: "Mensagem padrão"
                },
                include: { user: true }
            });
            console.log(`💾 [DEBUG-BANCO] Nova sessão criada com sucesso no banco. Pasta alvo: "${pastaPadrao}"`);
        } else {
            console.log(`✅ [DEBUG-BANCO] Sessão encontrada! Usuário: "${sessao.user?.nome || 'Sem Nome'}", Pasta: "${sessao.pastaAuth}"`);
        }

        const nomeUsuario = sessao.user?.nome || "Usuário";
        const { pastaAuth } = sessao;

        console.log(`🧠 [DEBUG-MEMORIA] Verificando se a pasta "${pastaAuth}" já possui uma instância ativa na RAM...`);
        if (instanciasAtivas[pastaAuth]) {
            console.log(`➔ [DEBUG-MEMORIA] [${nomeUsuario}] Instância já ativa e operando. Evitando duplicidade.`);
            return;
        }
        console.log(`📌 [DEBUG-MEMORIA] Nenhuma instância ativa na RAM para "${pastaAuth}". Prosseguindo...`);

        console.log(`📁 [DEBUG-AUTH] Inicializando useMultiFileAuthState para a pasta: "${pastaAuth}"`);
        const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);
        console.log(`✅ [DEBUG-AUTH] Estado de autenticação carregado da pasta.`);

        console.log(`⚡ [DEBUG-BAILEYS] Chamando makeWASocket() para erguer a conexão de rede...`);
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false // Desativado o nativo para usarmos o gerador manual garantido abaixo
        });

        console.log(`💾 [DEBUG-MEMORIA] Alocando socket na variável global para o caminho "${pastaAuth}"`);
        instanciasAtivas[pastaAuth] = sock;

        console.log(`📡 [DEBUG-EVENTOS] Plugando escuta de eventos (connection.update e creds.update)...`);

        sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
            const { connection, lastDisconnect, qr } = update;

            // Se houver string de QR Code emitida pelo Baileys, intercepta e desenha manualmente
            if (qr) {
                console.log(`\n✨ [DEBUG-QR] [${nomeUsuario}] Novo QR Code recebido! Escaneie com o seu WhatsApp abaixo:`);
                
                // Desenha o QR Code na marra usando caracteres de texto pequenos (compatível com o VS Code)
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                const erroStatusCode = (lastDisconnect?.error as any)?.output?.statusCode;
                const deveReconectar = erroStatusCode !== DisconnectReason.loggedOut && erroStatusCode !== 403;

                console.log(`\n❌ [DEBUG-CONEXÃO] [${nomeUsuario}] Conexão FECHADA. Status Code Interno: ${erroStatusCode}`);
                console.log(`🔄 [DEBUG-CONEXÃO] [${nomeUsuario}] Critério de auto-reconexão aceito? ${deveReconectar}`);
                
                console.log(`🗑️ [DEBUG-MEMORIA] Limpando a instância morta de "${pastaAuth}" da RAM...`);
                delete instanciasAtivas[pastaAuth];

                if (deveReconectar) {
                    console.log(`⏳ [DEBUG-RECONEXÃO] Agendando reinicialização do motor em 5 segundos...`);
                    setTimeout(() => {
                        console.log(`🚀 [DEBUG-RECONEXÃO] Disparando gatilho de reconexão para o userId: ${userId}`);
                        conectarWhatsApp(userId);
                    }, 5000);
                } else {
                    console.log(`🛑 [DEBUG-CONEXÃO] Conexão encerrada de forma definitiva pelo WhatsApp (Logout/Ban).`);
                }
            } 
            else if (connection === 'open') {
                console.log(`\n👑 ==================================================`);
                console.log(`✅ [DEBUG-CONEXÃO] [${nomeUsuario}] WHATSAPP CONECTADO E PRONTO PARA DISPAROS!`);
                console.log(`======================================================`);
            }
        });

        sock.ev.on('creds.update', () => {
            console.log(`💾 [DEBUG-SESSÃO] [${nomeUsuario}] Novas chaves/tokens gerados pelo WhatsApp. Salvando na pasta...`);
            saveCreds();
        });

        console.log(`🚀 [DEBUG-START] Função conectarWhatsApp finalizou sua execução síncrona inicial. Aguardando eventos do WhatsApp...`);

    } catch (error) {
        console.error(`\n💥 [DEBUG-ERRO-CRÍTICO] Falha grave dentro do fluxo conectarWhatsApp:`, error);
    }
}

/**
 * DISPARO LIVRE: Envia qualquer mensagem para qualquer número
 */
export async function enviarMensagemLivre(userId: string, numeroDestino: string, mensagem: string): Promise<boolean> {
    console.log(`\n✉️ [DEBUG-DISPARO] Iniciando envio livre comandado para o usuário: ${userId}`);
    try {
        const sessao = await prisma.whatsappSession.findUnique({
            where: { userId }
        });

        if (!sessao) {
            console.error(`❌ [DEBUG-DISPARO] Erro: userId ${userId} não possui registro de sessão.`);
            return false;
        }

        const { pastaAuth } = sessao;
        const clientSock = instanciasAtivas[pastaAuth];

        if (!clientSock) {
            console.error(`❌ [DEBUG-DISPARO] Erro: O WhatsApp do usuário não está inicializado na memória RAM.`);
            return false;
        }

        const apenasNumeros = numeroDestino.replace(/\D/g, '');
        if (!apenasNumeros) {
            console.error(`❌ [DEBUG-DISPARO] Erro: O número "${numeroDestino}" está inválido ou vazio.`);
            return false;
        }

        const numeroFormatado = `${apenasNumeros}@s.whatsapp.net`;
        console.log(`➔ [DEBUG-DISPARO] Despachando pacote de texto para: ${numeroFormatado}...`);

        await clientSock.sendMessage(numeroFormatado, { text: mensagem });
        
        console.log(`✅ [DEBUG-DISPARO] Mensagem enviada com sucesso para ${apenasNumeros}!`);
        return true;

    } catch (error) {
        console.error(`❌ [DEBUG-DISPARO] Falha na rede ao tentar empurrar a mensagem:`, error);
        return false;
    }
}