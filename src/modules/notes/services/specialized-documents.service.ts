import { Injectable } from '@nestjs/common';
import { DocumentStorageService } from './document-storage.service';

/**
 * Servicio especializado en el ciclo de vida y persistencia de Documentos Puros:
 * Hojas de Cálculo ('sheet'), Documentos de Texto ('doc'), Diapositivas ('slide') y Pizarras ('canvas').
 * Encapsula la lógica de inicialización, hidratación y almacenamiento en disco no bloqueante.
 */
@Injectable()
export class SpecializedDocumentsService {
  constructor(private readonly storageService: DocumentStorageService) {}

  /**
   * Genera la estructura inicial por defecto de cada tipo de documento especializado.
   */
  getDefaultSpecializedData(docType: string, noteId: string, title?: string): any {
    if (docType === 'sheet') {
      return {
        id: `wb-${noteId}`,
        name: title || 'Hoja 1',
        sheets: {
          'sheet-01': {
            id: 'sheet-01',
            name: 'Hoja 1',
            rowCount: 50,
            columnCount: 20,
            cellData: {},
          },
        },
      };
    } else if (docType === 'doc') {
      const t = title || 'Nuevo Documento';
      return {
        id: `doc-${noteId}`,
        title: t,
        body: {
          dataStream: '\r\n',
          textRuns: [],
          paragraphs: [
            {
              startIndex: 0,
              paragraphId: `p-${noteId}-0`,
              paragraphStyle: {},
            },
          ],
          sectionBreaks: [
            {
              startIndex: 1,
              sectionId: `s-${noteId}-0`,
            },
          ],
        },
        documentStyle: {
          pageSize: {
            width: 794,
            height: 1124,
          },
          documentFlavor: 1,
          marginTop: 72,
          marginBottom: 72,
          marginRight: 72,
          marginLeft: 72,
        },
      };
    } else if (docType === 'canvas') {
      return {
        elements: [],
        appState: {
          viewBackgroundColor: '#ffffff',
        },
      };
    } else if (docType === 'slide') {
      return {
        format: 'pptx',
        base64: '',
      };
    }
    return null;
  }

  /**
   * Hidrata de forma asíncrona los datos físicos de un documento especializado.
   */
  async hydrateDocument(noteObj: any): Promise<any> {
    if (!noteObj || !noteObj.docType || noteObj.docType === 'block' || noteObj.docType === 'latex') {
      return noteObj;
    }

    const noteIdStr = noteObj._id ? noteObj._id.toString() : '';

    if (noteObj.docType === 'slide') {
      const base64 = await this.storageService.readPptxBase64(noteIdStr);
      if (base64 !== null) {
        noteObj.docData = { format: 'pptx', base64 };
      }
    } else {
      const physicalData = await this.storageService.readDocument(noteIdStr, noteObj.docType);
      if (physicalData !== null) {
        noteObj.docData = physicalData;
      }
    }
    return noteObj;
  }

  /**
   * Persiste en disco un nuevo documento especializado y retorna la URL física y los datos en memoria.
   */
  async createSpecializedDocument(
    noteId: string,
    docType: string,
    title?: string,
    providedData?: any,
  ): Promise<{ docUrl: string | null; initialDocData: any }> {
    const initialDocData =
      providedData ?? this.getDefaultSpecializedData(docType, noteId, title);

    let docUrl: string | null = null;
    if (docType === 'slide') {
      docUrl = await this.storageService.savePptx(noteId, initialDocData?.base64 ?? '');
    } else {
      docUrl = await this.storageService.saveDocument(noteId, docType, initialDocData);
    }

    return { docUrl, initialDocData };
  }

  /**
   * Actualiza el contenido físico en disco de un documento especializado.
   */
  async updateSpecializedDocument(
    noteId: string,
    docType: string,
    docData: any,
    title?: string,
  ): Promise<{ docUrl: string | null; memoryDocData: any }> {
    let docUrl: string | null = null;
    let memoryDocData: any = undefined;

    if (docType === 'slide') {
      docUrl = await this.storageService.savePptx(noteId, docData?.base64 ?? '');
      memoryDocData = {
        format: 'pptx',
        base64: docData?.base64 ?? '',
        updatedAt: docData?.updatedAt,
      };
    } else {
      if (title && typeof docData === 'object' && docData !== null) {
        docData.title = title;
      }
      docUrl = await this.storageService.saveDocument(noteId, docType, docData);
      memoryDocData = docData;
    }

    return { docUrl, memoryDocData };
  }

  /**
   * Lee directamente los datos de un documento especializado.
   */
  async readSpecializedDocument(noteId: string, docType: string): Promise<any> {
    if (docType === 'slide') {
      const base64 = await this.storageService.readPptxBase64(noteId);
      return base64 !== null ? { format: 'pptx', base64 } : null;
    }
    return this.storageService.readDocument(noteId, docType);
  }

  /**
   * Elimina el archivo físico de un documento especializado del disco.
   */
  async deleteSpecializedDocument(noteId: string, docType: string): Promise<void> {
    await this.storageService.deleteDocument(noteId, docType);
  }
}
