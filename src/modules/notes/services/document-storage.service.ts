import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

/**
 * Contrato de almacenamiento para documentos especializados (hojas de cálculo,
 * documentos de texto enriquecido, lienzos vectoriales y presentaciones).
 * Sigue el principio de Inversión de Dependencias (DIP) y bajo acoplamiento.
 */
export interface IDocumentStorageService {
  saveDocument(noteId: string, docType: string, data: any): Promise<string>;
  readDocument(noteId: string, docType: string): Promise<any>;
  savePptx(noteId: string, base64: string): Promise<string>;
  readPptxBase64(noteId: string): Promise<string | null>;
  deleteDocument(noteId: string, docType?: string): Promise<void>;
}

/**
 * Servicio de Almacenamiento Físico de Documentos Asíncrono.
 * Gestiona la persistencia de payloads pesados en disco local y/o en Cloudflare R2
 * mediante I/O no bloqueante, liberando el Event Loop de Node.js y aislando
 * la lógica de archivos fuera de la capa de dominio.
 */
@Injectable()
export class DocumentStorageService implements IDocumentStorageService {
  private readonly logger = new Logger(DocumentStorageService.name);
  private readonly documentsDir = path.resolve(process.cwd(), 'uploads', 'documents');
  private readonly s3Client: S3Client | null = null;
  private readonly bucketName = process.env.R2_BUCKET_NAME || '';

  constructor() {
    this.ensureDirectoryExists();

    if (
      process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      this.bucketName
    ) {
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: process.env.R2_ENDPOINT,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });
      this.logger.log(`Almacenamiento Cloudflare R2 activado para el bucket: ${this.bucketName}`);
    }
  }

  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.documentsDir)) {
      try {
        fs.mkdirSync(this.documentsDir, { recursive: true });
      } catch (err) {
        this.logger.warn(`No se pudo crear el directorio local ${this.documentsDir}: ${err}`);
      }
    }
  }

  private getDocFilePath(noteId: string, docType: string): string {
    return path.join(this.documentsDir, `${noteId}_${docType}.json`);
  }

  private getDocFileUrl(noteId: string, docType: string): string {
    return `/uploads/documents/${noteId}_${docType}.json`;
  }

  private getPptxFilePath(noteId: string): string {
    return path.join(this.documentsDir, `${noteId}.pptx`);
  }

  private getPptxFileUrl(noteId: string): string {
    return `/uploads/documents/${noteId}.pptx`;
  }

  /**
   * Guarda de forma asíncrona los datos de un documento especializado (JSON).
   * Persiste en Cloudflare R2 y mantiene copia en disco local si está disponible.
   */
  async saveDocument(noteId: string, docType: string, data: any): Promise<string> {
    const jsonContent = JSON.stringify(data ?? {}, null, 2);
    const relativeUrl = this.getDocFileUrl(noteId, docType);
    let r2Saved = false;

    // 1. Persistir en Cloudflare R2 si está configurado
    if (this.s3Client && this.bucketName) {
      try {
        const key = `uploads/documents/${noteId}_${docType}.json`;
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            Body: jsonContent,
            ContentType: 'application/json',
          }),
        );
        r2Saved = true;
      } catch (err) {
        this.logger.error(`Error saving document to R2 ${noteId} (${docType}):`, err);
      }
    }

    // 2. Persistir en disco local (o caché)
    try {
      const filePath = this.getDocFilePath(noteId, docType);
      await fs.promises.writeFile(filePath, jsonContent, 'utf-8');
    } catch (err) {
      if (!r2Saved) {
        this.logger.error(`Error saving physical document ${noteId} (${docType}):`, err);
        return '';
      }
    }

    return relativeUrl;
  }

  /**
   * Lee de forma asíncrona los datos de un documento especializado (JSON).
   * Intenta primero la lectura local; si no existe, recupera de Cloudflare R2.
   */
  async readDocument(noteId: string, docType: string): Promise<any> {
    const filePath = this.getDocFilePath(noteId, docType);

    // 1. Intentar leer de disco local
    try {
      const exists = await fs.promises
        .access(filePath, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        const raw = await fs.promises.readFile(filePath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      this.logger.warn(`No se pudo leer localmente ${noteId} (${docType}), consultando R2...`);
    }

    // 2. Si no se encuentra localmente, recuperar de Cloudflare R2
    if (this.s3Client && this.bucketName) {
      try {
        const key = `uploads/documents/${noteId}_${docType}.json`;
        const response = await this.s3Client.send(
          new GetObjectCommand({
            Bucket: this.bucketName,
            Key: key,
          }),
        );
        if (response.Body) {
          const str = await response.Body.transformToString('utf-8');
          const parsed = JSON.parse(str);
          // Escribir en caché local si es posible
          try {
            await fs.promises.writeFile(filePath, str, 'utf-8');
          } catch {}
          return parsed;
        }
      } catch (err) {
        this.logger.error(`Error reading document from R2 ${noteId} (${docType}):`, err);
      }
    }

    return null;
  }

  /**
   * Guarda de forma asíncrona un archivo PowerPoint binario (.pptx) decodificando el base64.
   */
  async savePptx(noteId: string, base64: string): Promise<string> {
    if (!base64) {
      return '';
    }

    const buffer = Buffer.from(base64, 'base64');
    const relativeUrl = this.getPptxFileUrl(noteId);
    let r2Saved = false;

    // 1. Persistir en Cloudflare R2
    if (this.s3Client && this.bucketName) {
      try {
        const key = `uploads/documents/${noteId}.pptx`;
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            Body: buffer,
            ContentType:
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          }),
        );
        r2Saved = true;
      } catch (err) {
        this.logger.error(`Error saving PPTX to R2 ${noteId}:`, err);
      }
    }

    // 2. Persistir en disco local
    try {
      const filePath = this.getPptxFilePath(noteId);
      await fs.promises.writeFile(filePath, buffer);
    } catch (err) {
      if (!r2Saved) {
        this.logger.error(`Error saving physical PPTX ${noteId}:`, err);
        return '';
      }
    }

    return relativeUrl;
  }

  /**
   * Lee de forma asíncrona el archivo PowerPoint y lo convierte a base64.
   */
  async readPptxBase64(noteId: string): Promise<string | null> {
    const filePath = this.getPptxFilePath(noteId);

    // 1. Intentar disco local
    try {
      const exists = await fs.promises
        .access(filePath, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        const buffer = await fs.promises.readFile(filePath);
        return buffer.toString('base64');
      }
    } catch (err) {
      this.logger.warn(`No se pudo leer localmente PPTX ${noteId}, consultando R2...`);
    }

    // 2. Intentar Cloudflare R2
    if (this.s3Client && this.bucketName) {
      try {
        const key = `uploads/documents/${noteId}.pptx`;
        const response = await this.s3Client.send(
          new GetObjectCommand({
            Bucket: this.bucketName,
            Key: key,
          }),
        );
        if (response.Body) {
          const bytes = await response.Body.transformToByteArray();
          const base64 = Buffer.from(bytes).toString('base64');
          try {
            await fs.promises.writeFile(filePath, Buffer.from(bytes));
          } catch {}
          return base64;
        }
      } catch (err) {
        this.logger.error(`Error reading PPTX from R2 ${noteId}:`, err);
      }
    }

    return null;
  }

  /**
   * Elimina de forma asíncrona los archivos asociados a un documento tanto en local como en R2.
   */
  async deleteDocument(noteId: string, docType?: string): Promise<void> {
    // 1. Limpieza local
    try {
      if (docType) {
        if (docType === 'slide') {
          await this.safeUnlink(this.getPptxFilePath(noteId));
        }
        await this.safeUnlink(this.getDocFilePath(noteId, docType));
      } else {
        const types = ['sheet', 'doc', 'canvas', 'slide'];
        for (const t of types) {
          await this.safeUnlink(this.getDocFilePath(noteId, t));
        }
        await this.safeUnlink(this.getPptxFilePath(noteId));
      }
    } catch (err) {
      this.logger.error(`Error deleting physical files for note ${noteId}:`, err);
    }

    // 2. Limpieza en Cloudflare R2
    if (this.s3Client && this.bucketName) {
      const keysToDelete: string[] = [];
      if (docType) {
        if (docType === 'slide') {
          keysToDelete.push(`uploads/documents/${noteId}.pptx`);
        }
        keysToDelete.push(`uploads/documents/${noteId}_${docType}.json`);
      } else {
        for (const t of ['sheet', 'doc', 'canvas']) {
          keysToDelete.push(`uploads/documents/${noteId}_${t}.json`);
        }
        keysToDelete.push(`uploads/documents/${noteId}.pptx`);
      }

      for (const key of keysToDelete) {
        try {
          await this.s3Client.send(
            new DeleteObjectCommand({
              Bucket: this.bucketName,
              Key: key,
            }),
          );
        } catch (err) {
          this.logger.warn(`No se pudo eliminar de R2 la clave ${key}:`, err);
        }
      }
    }
  }

  private async safeUnlink(filePath: string): Promise<void> {
    try {
      const exists = await fs.promises
        .access(filePath, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        await fs.promises.unlink(filePath);
      }
    } catch {
      // Ignorar si ya no existe
    }
  }
}
