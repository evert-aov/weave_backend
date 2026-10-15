import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { NotesRepository } from '../repositories/notes.repository';
import { CreateNoteDto, UpdateNoteDto } from '../dto/note.dto';
import { CreateBlockDto, UpdateBlockDto, ReorderBlocksDto } from '../dto/block.dto';
import { Block } from '../entities/block.entity';

/**
 * Servicio de dominio para Gestión de Notas y Bloques.
 * Implementa las reglas de negocio, ordenación y validaciones.
 * Almacena documentos 'block' (todo en uno) directamente en MongoDB y almacena
 * documentos especializados ('sheet', 'doc', 'canvas') en archivos físicos JSON en el disco,
 * guardando solo el enlace 'docUrl' en MongoDB para no sobrecargar la base de datos.
 * Las presentaciones ('slide') se guardan como archivo binario .pptx real en disco,
 * almacenando únicamente su referencia 'docUrl' en MongoDB.
 */
@Injectable()
export class NotesService {
  private readonly documentsDir = path.resolve(process.cwd(), 'uploads', 'documents');

  constructor(private readonly notesRepository: NotesRepository) {
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

  private writePhysicalDoc(noteId: string, docType: string, data: any): string {
    try {
      const filePath = this.getDocFilePath(noteId, docType);
      fs.writeFileSync(filePath, JSON.stringify(data ?? {}, null, 2), 'utf-8');
      return this.getDocFileUrl(noteId, docType);
    } catch (err) {
      console.error(`[NotesService] Error writing physical document ${noteId}:`, err);
      return '';
    }
  }

  private readPhysicalDoc(noteId: string, docType: string): any {
    try {
      const filePath = this.getDocFilePath(noteId, docType);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.error(`[NotesService] Error reading physical document ${noteId}:`, err);
    }
    return null;
  }

  /**
   * Ruta física del archivo binario .pptx de una presentación.
   * A diferencia de los documentos JSON, las presentaciones se almacenan
   * como un archivo PowerPoint real en el disco.
   */
  private getPptxFilePath(noteId: string): string {
    return path.join(this.documentsDir, `${noteId}.pptx`);
  }

  private getPptxFileUrl(noteId: string): string {
    return `/uploads/documents/${noteId}.pptx`;
  }

  /**
   * Escribe el archivo binario .pptx decodificando el base64 recibido.
   * Devuelve la URL de referencia almacenada en MongoDB, o cadena vacía si falla.
   */
  private writePhysicalPptx(noteId: string, base64: string): string {
    try {
      if (!base64) {
        return '';
      }
      const filePath = this.getPptxFilePath(noteId);
      const buffer = Buffer.from(base64, 'base64');
      fs.writeFileSync(filePath, buffer);
      return this.getPptxFileUrl(noteId);
    } catch (err) {
      console.error(`[NotesService] Error writing physical PPTX ${noteId}:`, err);
      return '';
    }
  }

  /**
   * Lee el archivo .pptx físico y lo devuelve codificado en base64 para el cliente.
   */
  private readPhysicalPptxBase64(noteId: string): string | null {
    try {
      const filePath = this.getPptxFilePath(noteId);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath).toString('base64');
      }
    } catch (err) {
      console.error(`[NotesService] Error reading physical PPTX ${noteId}:`, err);
    }
    return null;
  }

  private deletePhysicalPptx(noteId: string): void {
    try {
      const filePath = this.getPptxFilePath(noteId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error(`[NotesService] Error deleting physical PPTX ${noteId}:`, err);
    }
  }

  /**
   * Construye el docData de una presentación a partir del archivo físico en disco.
   */
  private buildSlideDocData(noteId: string): any {
    const base64 = this.readPhysicalPptxBase64(noteId);
    if (base64 === null) {
      return null;
    }
    return { format: 'pptx', base64 };
  }

  private deletePhysicalDoc(noteId: string, docType?: string): void {
    try {
      if (docType) {
        if (docType === 'slide') {
          this.deletePhysicalPptx(noteId);
          // Eliminar también posibles JSON heredados de versiones anteriores
        }
        const filePath = this.getDocFilePath(noteId, docType);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } else {
        const types = ['sheet', 'doc', 'canvas', 'slide'];
        for (const t of types) {
          const fp = this.getDocFilePath(noteId, t);
          if (fs.existsSync(fp)) {
            fs.unlinkSync(fp);
          }
        }
        this.deletePhysicalPptx(noteId);
      }
    } catch (err) {
      console.error(`[NotesService] Error deleting physical document ${noteId}:`, err);
    }
  }

  private getDefaultSpecializedData(docType: string, noteId: string, title?: string): any {
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
   * Obtiene la lista de notas de un usuario filtradas opcionalmente por espacio.
   */
  async getNotes(userId: string, space?: string) {
    let notes = await this.notesRepository.findAllByUser(userId, space);
    if (notes.length === 0 && (!space || space === 'all' || space === 'Research')) {
      const allUserNotes = await this.notesRepository.findAllByUser(userId);
      if (allUserNotes.length === 0) {
        const welcomeNote = await this.notesRepository.create({
          userId: Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : (userId as any),
          title: 'Bienvenido a Weave',
          lead: 'Tu espacio de trabajo privado para notas, código y fórmulas.',
          space: 'Research',
          tags: ['Inicio'],
          blocks: [
            {
              id: `b-${Date.now()}-1`,
              type: 'text',
              order: 0,
              content: {
                html: '<p>Este es tu espacio personal. Toda tu información y notas están aisladas de forma segura en tu cuenta.</p>',
              },
              metadata: {},
            },
          ],
        });
        notes = [welcomeNote];
      }
    }
    // Hidratar docData para cada nota especializada para que la carga inicial sea completa e inmediata
    return notes.map((n) => {
      const noteObj: any = n.toObject ? n.toObject() : { ...n };
      if (noteObj.docType === 'slide') {
        const slideData = this.buildSlideDocData(noteObj._id.toString());
        if (slideData !== null) {
          noteObj.docData = slideData;
        }
      } else if (noteObj.docType && noteObj.docType !== 'block') {
        const physicalData = this.readPhysicalDoc(noteObj._id.toString(), noteObj.docType);
        if (physicalData !== null) {
          noteObj.docData = physicalData;
        }
      }
      return noteObj;
    });
  }

  /**
   * Obtiene un documento de nota por su identificador.
   * Si es un documento especializado, hidrata dinámicamente 'docData' desde el archivo físico.
   */
  async getNoteById(id: string, userId: string) {
    const note = await this.notesRepository.findByIdAndUser(id, userId);
    if (!note) {
      throw new NotFoundException('Note not found');
    }

    const noteObj: any = note.toObject ? note.toObject() : { ...note };
    if (noteObj.docType === 'slide') {
      const slideData = this.buildSlideDocData(id);
      if (slideData !== null) {
        noteObj.docData = slideData;
      }
    } else if (noteObj.docType && noteObj.docType !== 'block') {
      const physicalData = this.readPhysicalDoc(id, noteObj.docType);
      if (physicalData !== null) {
        noteObj.docData = physicalData;
      }
    }
    return noteObj;
  }

  /**
   * Crea una nueva nota. Si es especializada ('sheet', 'doc', 'canvas'), guarda su contenido
   * en un archivo físico en el disco y almacena en MongoDB únicamente la referencia 'docUrl'.
   */
  async createNote(userId: string, createNoteDto: CreateNoteDto) {
    const docType = createNoteDto.docType || 'block';
    const noteId = new Types.ObjectId();
    const noteIdStr = noteId.toString();

    let docUrl: string | null = null;
    let initialDocData: any = null;

    if (docType !== 'block') {
      initialDocData =
        createNoteDto.docData ??
        this.getDefaultSpecializedData(docType, noteIdStr, createNoteDto.title);
      if (docType === 'slide') {
        // Las presentaciones se almacenan como archivo binario .pptx real en disco
        docUrl = this.writePhysicalPptx(noteIdStr, initialDocData?.base64 ?? '');
        // Normalizar la respuesta en memoria para el cliente
        initialDocData = { format: 'pptx', base64: initialDocData?.base64 ?? '' };
      } else {
        docUrl = this.writePhysicalDoc(noteIdStr, docType, initialDocData);
      }
    }

    const initialBlocks: Block[] = createNoteDto.blocks?.length
      ? (createNoteDto.blocks as Block[])
      : docType === 'block'
      ? [
          {
            id: `b-${Date.now()}-1`,
            type: 'text',
            order: 0,
            content: {
              html: '<p>Start writing your thoughts, formulas, or code here...</p>',
            },
            metadata: {},
          },
        ]
      : [];

    const created = await this.notesRepository.create({
      _id: noteId as any,
      userId: Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : (userId as any),
      title: createNoteDto.title,
      lead: createNoteDto.lead ?? '',
      space: createNoteDto.space ?? 'Research',
      docType: docType,
      docUrl: docUrl || undefined,
      docData: null, // No almacenar el JSON en MongoDB para evitar llenar la base de datos
      tags: createNoteDto.tags ?? [],
      blocks: initialBlocks,
    });

    const createdObj: any = created.toObject ? created.toObject() : { ...created };
    if (docType !== 'block') {
      createdObj.docData = initialDocData;
    }
    return createdObj;
  }

  /**
   * Actualiza el contenido y metadatos de un documento.
   * Si es especializado, persiste los datos en archivo físico y actualiza 'docUrl'.
   */
  async updateNote(id: string, userId: string, updateNoteDto: UpdateNoteDto) {
    const note = await this.notesRepository.findByIdAndUser(id, userId);
    if (!note) {
      throw new NotFoundException('Note not found');
    }

    const effectiveDocType = updateNoteDto.docType || note.docType || 'block';
    let memoryDocData: any = undefined;

    if (effectiveDocType !== 'block') {
      if (updateNoteDto.docData !== undefined && updateNoteDto.docData !== null) {
        if (effectiveDocType === 'slide') {
          // Persistir el binario .pptx en disco y guardar solo la referencia en MongoDB
          const docUrl = this.writePhysicalPptx(id, updateNoteDto.docData?.base64 ?? '');
          if (docUrl) {
            updateNoteDto.docUrl = docUrl;
          }
          memoryDocData = {
            format: 'pptx',
            base64: updateNoteDto.docData?.base64 ?? '',
            updatedAt: updateNoteDto.docData?.updatedAt,
          };
        } else {
          if (updateNoteDto.title && typeof updateNoteDto.docData === 'object') {
            updateNoteDto.docData.title = updateNoteDto.title;
          }
          const docUrl = this.writePhysicalDoc(id, effectiveDocType, updateNoteDto.docData);
          if (docUrl) {
            updateNoteDto.docUrl = docUrl;
          }
          memoryDocData = updateNoteDto.docData;
        }
        // Evitar guardar docData pesado en MongoDB
        updateNoteDto.docData = null;
      } else if (updateNoteDto.title && effectiveDocType !== 'slide') {
        const existingData = this.readPhysicalDoc(id, effectiveDocType);
        if (existingData && typeof existingData === 'object') {
          existingData.title = updateNoteDto.title;
          this.writePhysicalDoc(id, effectiveDocType, existingData);
        }
      }
    }

    const updated = await this.notesRepository.update(id, userId, {
      ...updateNoteDto,
      blocks: updateNoteDto.blocks !== undefined ? (updateNoteDto.blocks as Block[]) : note.blocks,
    });

    if (!updated) {
      throw new NotFoundException('Note update failed');
    }

    const resultObj: any = updated.toObject ? updated.toObject() : { ...updated };
    if (effectiveDocType !== 'block') {
      if (memoryDocData !== undefined) {
        resultObj.docData = memoryDocData;
      } else if (effectiveDocType === 'slide') {
        resultObj.docData = this.buildSlideDocData(id);
      } else {
        resultObj.docData = this.readPhysicalDoc(id, effectiveDocType);
      }
    }
    return resultObj;
  }

  /**
   * Elimina un documento de nota y borra su archivo físico correspondiente del disco.
   */
  async deleteNote(id: string, userId: string) {
    const note = await this.notesRepository.findByIdAndUser(id, userId);
    if (!note) {
      throw new NotFoundException('Note not found');
    }

    if (note.docType && note.docType !== 'block') {
      this.deletePhysicalDoc(id, note.docType);
    }

    const deleted = await this.notesRepository.delete(id, userId);
    if (!deleted) {
      throw new NotFoundException('Note not found');
    }
    return { success: true, message: 'Note deleted successfully' };
  }

  /**
   * Añade un nuevo bloque al documento en una posición específica.
   */
  async addBlock(noteId: string, userId: string, createBlockDto: CreateBlockDto) {
    const note = await this.getNoteById(noteId, userId);
    const newOrder =
      createBlockDto.order !== undefined
        ? createBlockDto.order
        : note.blocks.length;

    const newBlock: Block = {
      id: createBlockDto.id,
      type: createBlockDto.type,
      order: newOrder,
      content: createBlockDto.content ?? {},
      metadata: createBlockDto.metadata ?? {},
    };

    const updatedBlocks = [...note.blocks];
    updatedBlocks.splice(newOrder, 0, newBlock);

    // Normalizar orden secuencial de los bloques
    updatedBlocks.forEach((block, index) => {
      block.order = index;
    });

    return this.notesRepository.update(noteId, userId, { blocks: updatedBlocks });
  }

  /**
   * Actualiza los datos o el contenido de un bloque existente.
   */
  async updateBlock(
    noteId: string,
    blockId: string,
    userId: string,
    updateBlockDto: UpdateBlockDto,
  ) {
    const note = await this.getNoteById(noteId, userId);
    const blocks: Block[] = (note.blocks || []) as Block[];
    const blockIndex = blocks.findIndex((b: Block) => b.id === blockId);

    if (blockIndex === -1) {
      throw new NotFoundException('Block not found');
    }

    const currentBlock = blocks[blockIndex];
    const updatedBlock: Block = {
      ...currentBlock,
      ...updateBlockDto,
      content: updateBlockDto.content
        ? { ...currentBlock.content, ...updateBlockDto.content }
        : currentBlock.content,
      metadata: updateBlockDto.metadata
        ? { ...currentBlock.metadata, ...updateBlockDto.metadata }
        : currentBlock.metadata,
    };

    const updatedBlocks = [...blocks];
    updatedBlocks[blockIndex] = updatedBlock;

    return this.notesRepository.update(noteId, userId, { blocks: updatedBlocks });
  }

  /**
   * Elimina un bloque específico del documento.
   */
  async removeBlock(noteId: string, blockId: string, userId: string) {
    const note = await this.getNoteById(noteId, userId);
    const blocks: Block[] = (note.blocks || []) as Block[];
    const updatedBlocks = blocks.filter((b: Block) => b.id !== blockId);

    // Reordenar índices secuenciales
    updatedBlocks.forEach((block: Block, index: number) => {
      block.order = index;
    });

    return this.notesRepository.update(noteId, userId, { blocks: updatedBlocks });
  }

  /**
   * Reordena los bloques según una lista ordenada de IDs.
   */
  async reorderBlocks(
    noteId: string,
    userId: string,
    reorderDto: ReorderBlocksDto,
  ) {
    const note = await this.getNoteById(noteId, userId);
    const blocks: Block[] = (note.blocks || []) as Block[];
    const blockMap = new Map<string, Block>(blocks.map((b: Block) => [b.id, b]));

    const reorderedBlocks: Block[] = [];
    reorderDto.blockIds.forEach((id: string, index: number) => {
      const block = blockMap.get(id);
      if (block) {
        block.order = index;
        reorderedBlocks.push(block);
        blockMap.delete(id);
      }
    });

    // Añadir cualquier bloque remanente al final
    blockMap.forEach((block: Block) => {
      block.order = reorderedBlocks.length;
      reorderedBlocks.push(block);
    });

    return this.notesRepository.update(noteId, userId, {
      blocks: reorderedBlocks,
    });
  }
}
