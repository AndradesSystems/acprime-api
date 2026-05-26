import { v2 as cloudinary } from "cloudinary";
import multer from "multer";

// Inicializa a configuração do Cloudinary dando prioridade para a URL única
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({
    cloudinary_url: process.env.CLOUDINARY_URL ?? "",
  });
} else {
  // Fallback de segurança para chaves separadas se necessário
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME ?? "",
    api_key: process.env.CLOUDINARY_API_KEY ?? "",
    api_secret: process.env.CLOUDINARY_API_SECRET ?? "",
  });
}

// Configura o multer para armazenar arquivos temporariamente na memória RAM
const storage = multer.memoryStorage();

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // Limite de segurança de 5MB por foto
  },
});

/**
 * Transforma o Buffer recebido pelo Multer em um Stream de upload direto para o Cloudinary
 */
export const uploadToCloudinary = (fileBuffer: Buffer, folder: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: folder },
      (error, result) => {
        if (error) return reject(error);
        if (!result) return reject(new Error("Falha ao obter retorno do Cloudinary"));
        
        resolve(result.secure_url); // Retorna a URL segura (HTTPS) da foto
      }
    );

    uploadStream.end(fileBuffer);
  });
};