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

// Estado global das instâncias na memória
const instanciasAtivas: { [key: string]: WASocket } = {};
const qrCodesAtivos: { [key: string]: string } = {};
const statusConexoes: { [key: string]: 'CONNECTING' | 'OPEN' | 'QRCODE' | 'CLOSED' } = {};
const estoqueChavesMemoria: { [userId: string]: { [type: string]: { [id: string]: any } } } = {};

// 🔒 TRAVAS DE SEGURANÇA E FILAS POR USUÁRIO
const promessasInicializacao: { [userId: string]: Promise<void> | null } = {};
const filasDeEnvio: { [userId: string]: Array<{ toNumber: string; messageText: string; resolve: (v: boolean) => void; reject: (e: any) => void }> } = {};
const processandoFila: { [userId: string]: boolean } = {};

export class WhatsAppService {

    /**
     * Adaptador que gerencia as credenciais no banco e chaves na RAM
     */
    private static async usePrismaAuthState(userId: string): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> {
        const sessao = await prisma.whatsappSession.findUnique({ where: { userId } });

        let creds = initAuthCreds();
        if (sessao?.sessionData) {
            try {
                creds = JSON.parse(sessao.sessionData, BufferJSON.reviver);
            } catch (e) {
                console.error(`❌ Erro ao decodificar sessionData do banco para o usuário ${userId}:`, e);
            }
        }

        if (!estoqueChavesMemoria[userId]) {
            estoqueChavesMemoria[userId] = {};
        }

        const chavesDoUsuario = estoqueChavesMemoria[userId] as Record<string, any>;

        return {
            state: {
                creds,
                keys: {
                    get: (type, ids) => {
                        const dados: { [id: string]: any } = {};
                        for (const id of ids) {
                            dados[id] = chavesDoUsuario[type]?.[id];
                        }
                        return dados;
                    },
                    set: (data: any) => {
                        for (const type in data) {
                            if (!chavesDoUsuario[type]) {
                                chavesDoUsuario[type] = {};
                            }
                            Object.assign(chavesDoUsuario[type], data[type]);
                        }
                    }
                }
            },
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
     * LIGA O MOTOR: Inicializa o Baileys garantindo execução única por ID
     */
    static async conectarWhatsApp(userId: string): Promise<void> {
        if (promessasInicializacao[userId]) {
            return promessasInicializacao[userId]!;
        }

        const promessa = (async () => {
            console.log(`\n==================================================`);
            console.log(`🔍 [WhatsAppService] Inicializando motor para o ID: "${userId}"`);
            console.log(`==================================================`);

            try {
                statusConexoes[userId] = 'CONNECTING';

                let sessao = await prisma.whatsappSession.findUnique({
                    where: { userId },
                    include: { user: true }
                });

                if (!sessao) {
                    const pastaPadrao = `auth_${userId}`;
                    sessao = await prisma.whatsappSession.create({
                        data: { userId, pastaAuth: pastaPadrao, status: 'CONNECTING' },
                        include: { user: true }
                    });
                }

                const nomeUsuario = sessao.user?.nome || "Usuário";
                const { pastaAuth } = sessao;

                if (instanciasAtivas[pastaAuth]) {
                    console.log(`➔ [${nomeUsuario}] Instância ativa detectada na RAM.`);
                    statusConexoes[userId] = 'OPEN';
                    return;
                }

                const { state, saveCreds } = await this.usePrismaAuthState(userId);

                const sock = makeWASocket({
                    auth: state,
                    logger: pino({ level: 'silent' }),
                    printQRInTerminal: false
                });

                instanciasAtivas[pastaAuth] = sock;

                sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
                    const { connection, lastDisconnect, qr } = update;

                    if (qr) {
                        console.log(`✨ [QR CODE] Código gerado para: ${nomeUsuario}`);
                        qrCodesAtivos[userId] = qr;
                        statusConexoes[userId] = 'QRCODE';
                        await prisma.whatsappSession.update({ where: { userId }, data: { status: 'QRCODE' } });
                    }

                    if (connection === 'close') {
                        const erroStatusCode = (lastDisconnect?.error as any)?.output?.statusCode;
                        const deveReconectar = erroStatusCode !== DisconnectReason.loggedOut && erroStatusCode !== 403;

                        console.log(`❌ [CONEXÃO] [${nomeUsuario}] Socket fechado. Status: ${erroStatusCode}`);
                        statusConexoes[userId] = 'CLOSED';
                        await prisma.whatsappSession.update({ where: { userId }, data: { status: 'CLOSED' } });

                        if (erroStatusCode === DisconnectReason.loggedOut) {
                            console.log(`🗑️ [${nomeUsuario}] Desconectado via celular. Limpando credenciais...`);
                            await prisma.whatsappSession.update({ where: { userId }, data: { sessionData: null } });
                            delete estoqueChavesMemoria[userId];
                        }

                        delete instanciasAtivas[pastaAuth];
                        delete qrCodesAtivos[userId];

                        if (deveReconectar) {
                            console.log(`⏳ Agendando reconexão automática para ${nomeUsuario} em 5s...`);
                            setTimeout(() => this.conectarWhatsApp(userId), 5000);
                        }
                    }
                    else if (connection === 'open') {
                        console.log(`✅ [${nomeUsuario}] WHATSAPP CONECTADO COM SUCESSO!`);
                        statusConexoes[userId] = 'OPEN';
                        delete qrCodesAtivos[userId];
                        await prisma.whatsappSession.update({ where: { userId }, data: { status: 'OPEN' } });
                        
                        // Executa a fila de mensagens represadas se houver
                        this.processarFilaInterna(userId);
                    }
                });

                sock.ev.on('creds.update', saveCreds);

            } catch (error) {
                statusConexoes[userId] = 'CLOSED';
                console.error(`💥 Erro crítico no motor do usuário ${userId}:`, error);
            }
        })();

        promessasInicializacao[userId] = promessa;

        try {
            await promessa;
        } finally {
            promessasInicializacao[userId] = null;
        }
    }

    /**
     * ENTRADA DA FILA: Ponto centralizado de disparo de mensagens
     */
    static async sendMessage(userId: string, toNumber: string, messageText: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            if (!filasDeEnvio[userId]) {
                filasDeEnvio[userId] = [];
            }

            // Adiciona o pedido de envio na fila exclusiva do usuário
            filasDeEnvio[userId].push({ toNumber, messageText, resolve, reject });

            // Dispara o gatilho de execução da fila
            this.processarFilaInterna(userId);
        });
    }

    /**
     * MÁQUINA DE ESTADO DA FILA: Processa uma mensagem por vez para evitar Bloqueios e Atropelos
     */
    private static async processarFilaInterna(userId: string): Promise<void> {
        // Se já tiver uma mensagem sendo enviada por essa fila, sai e aguarda sua vez
        if (processandoFila[userId] || !filasDeEnvio[userId] || filasDeEnvio[userId].length === 0) {
            return;
        }

        processandoFila[userId] = true;

        const sessao = await prisma.whatsappSession.findUnique({ where: { userId } });
        const pastaAuth = sessao?.pastaAuth || `auth_${userId}`;

        // Loop enquanto houver mensagens pendentes na fila do usuário
        while (filasDeEnvio[userId] && filasDeEnvio[userId].length > 0) {
            // 💡 Captura e remove o primeiro elemento da fila de forma segura
            const tarefa = filasDeEnvio[userId].shift(); 

            // Se por algum motivo a tarefa for indefinida, ignora e continua o loop
            if (!tarefa) {
                continue;
            }

            try {
                // 1. Se a instância caiu da RAM, liga o motor e segura a fila
                if (!instanciasAtivas[pastaAuth]) {
                    console.log(`⚠️ [Fila] Instância de ${userId} fora da RAM. Inicializando motor antes de processar a fila...`);
                    
                    // Re-insere a tarefa no início da fila para não perdê-la
                    filasDeEnvio[userId].unshift(tarefa);
                    
                    await this.conectarWhatsApp(userId);

                    let tentativas = 0;
                    while (statusConexoes[userId] !== 'OPEN' && tentativas < 40) {
                        if (statusConexoes[userId] === 'QRCODE' || statusConexoes[userId] === 'CLOSED') {
                            throw new Error(`Conexão indisponível para envio. Status atual: ${statusConexoes[userId]}`);
                        }
                        await new Promise((r) => setTimeout(r, 500));
                        tentativas++;
                    }
                    
                    // Remove novamente a tarefa do topo da fila agora que o motor ligou
                    filasDeEnvio[userId].shift();
                }

                const clientSock = instanciasAtivas[pastaAuth];
                if (!clientSock || statusConexoes[userId] !== 'OPEN') {
                    throw new Error('Não foi possível estabelecer uma conexão estável.');
                }

                const apenasNumeros = tarefa.toNumber.replace(/\D/g, '');
                if (!apenasNumeros) throw new Error('Número de destino inválido.');

                console.log(`📡 [Fila] Verificando existência de JID para: ${apenasNumeros}`);
                const [resultado] = (await clientSock.onWhatsApp(apenasNumeros)) || [];

                if (!resultado || !resultado.exists) {
                    throw new Error('Este número não possui uma conta de WhatsApp ativa.');
                }

                // Dispara a mensagem de fato
                await clientSock.sendMessage(resultado.jid, { text: tarefa.messageText });
                console.log(`✅ [Fila] Mensagem enviada com sucesso para o JID: ${resultado.jid}`);
                
                tarefa.resolve(true); // Resolve a Promise de quem chamou lá no Cron

                // 🌟 ANTI-BAN: Pausa humana obrigatória entre mensagens DO MESMO CHIP (2 a 5 segundos)
                const delayAntiBan = Math.floor(Math.random() * (5000 - 2000 + 1) + 2000);
                console.log(`💤 [Anti-Ban] Aguardando ${delayAntiBan / 1000}s antes da próxima mensagem deste usuário...`);
                await new Promise((r) => setTimeout(r, delayAntiBan));

            } catch (error: any) {
                console.error(`❌ [Fila] Erro ao processar mensagem para ${tarefa.toNumber}:`, error.message || error);
                tarefa.reject(error); // Avisa o Cron que essa falhou
            }
        }

        // Fila processada por completo, libera a trava
        processandoFila[userId] = false;
    }

    /**
     * Busca o Status e o QR Code atualizado
     */
    static async getStatus(userId: string) {
        const sessao = await prisma.whatsappSession.findUnique({ where: { userId } });
        const pastaAuth = sessao?.pastaAuth || `auth_${userId}`;
        const estaNaRam = !!instanciasAtivas[pastaAuth];
        const statusAtual = statusConexoes[userId] || sessao?.status || (estaNaRam ? 'OPEN' : 'CLOSED');
        return {
            userId,
            status: statusAtual,
            qrCode: qrCodesAtivos[userId] || null,
            conectado: statusAtual === 'OPEN'
        };
    }

    /**
     * Encerra a sessão atual de forma limpa
     */
    static async desconectarWhatsApp(userId: string): Promise<boolean> {
        console.log(`\n📴 [WhatsAppService] Solicitando desconexão para o usuário: "${userId}"`);
        try {
            const sessao = await prisma.whatsappSession.findUnique({ where: { userId } });
            if (!sessao) throw new Error('Sessão não encontrada no banco de dados.');

            const { pastaAuth } = sessao;
            const clientSock = instanciasAtivas[pastaAuth];

            if (clientSock) {
                try {
                    await clientSock.logout();
                    clientSock.end(undefined);
                } catch (err) {
                    console.log(`⚠️ Aviso ao fechar socket:`, err);
                }
            }

            delete instanciasAtivas[pastaAuth];
            delete qrCodesAtivos[userId];
            delete estoqueChavesMemoria[userId];
            delete filasDeEnvio[userId];
            delete processandoFila[userId]; // Limpa a trava da fila também
            statusConexoes[userId] = 'CLOSED';

            await prisma.whatsappSession.update({
                where: { userId },
                data: { sessionData: null, status: 'CLOSED' }
            });

            console.log(`✅ [${pastaAuth}] Instância limpa e desconectada com sucesso.`);
            return true;
        } catch (error: any) {
            console.error(`❌ Erro ao desconectar usuário ${userId}:`, error.message || error);
            throw error;
        }
    }
}