import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

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
 * Gestiona la persistencia de payloads pesados en disco mediante I/O no bloqueante (fs.promises),
 * liberando el Event Loop de Node.js y aislando la lógica de archivos fuera de la capa de dominio.
 */
@Injectable()
export class DocumentStorageService implements IDocumentStorageService {
  private readonly logger = new Logger(DocumentStorageService.name);
  private readonly documentsDir = path.resolve(process.cwd(), 'uploads', 'documents');

  constructor() {
    this.ensureDirectoryExists();
  }

  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.documentsDir)) {
      fs.mkdirSync(this.documentsDir, { recursive: true });
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
   * Devuelve la URL relativa para consumo del cliente.
   */
  async saveDocument(noteId: string, docType: string, data: any): Promise<string> {
    try {
      const filePath = this.getDocFilePath(noteId, docType);
      const jsonContent = JSON.stringify(data ?? {}, null, 2);
      await fs.promises.writeFile(filePath, jsonContent, 'utf-8');
      return this.getDocFileUrl(noteId, docType);
    } catch (err) {
      this.logger.error(`Error saving physical document ${noteId} (${docType}):`, err);
      return '';
    }
  }

  /**
   * Lee de forma asíncrona los datos de un documento especializado (JSON).
   */
  async readDocument(noteId: string, docType: string): Promise<any> {
    try {
      const filePath = this.getDocFilePath(noteId, docType);
      const exists = await fs.promises
        .access(filePath, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        const raw = await fs.promises.readFile(filePath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      this.logger.error(`Error reading physical document ${noteId} (${docType}):`, err);
    }
    return null;
  }

  /**
   * Guarda de forma asíncrona un archivo PowerPoint binario (.pptx) decodificando el base64.
   */
  async savePptx(noteId: string, base64: string): Promise<string> {
    try {
      if (!base64) {
        return '';
      }
      const filePath = this.getPptxFilePath(noteId);
      const buffer = Buffer.from(base64, 'base64');
      await fs.promises.writeFile(filePath, buffer);
      return this.getPptxFileUrl(noteId);
    } catch (err) {
      this.logger.error(`Error saving physical PPTX ${noteId}:`, err);
      return '';
    }
  }

  /**
   * Lee de forma asíncrona el archivo PowerPoint y lo convierte a base64.
   */
  async readPptxBase64(noteId: string): Promise<string | null> {
    try {
      const filePath = this.getPptxFilePath(noteId);
      const exists = await fs.promises
        .access(filePath, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        const buffer = await fs.promises.readFile(filePath);
        return buffer.toString('base64');
      }
    } catch (err) {
      this.logger.error(`Error reading physical PPTX ${noteId}:`, err);
    }
    return null;
  }

  /**
   * Elimina de forma asíncrona los archivos asociados a un documento.
   */
  async deleteDocument(noteId: string, docType?: string): Promise<void> {
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
