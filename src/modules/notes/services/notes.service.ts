import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { NotesRepository } from '../repositories/notes.repository';
import { DocumentStorageService } from './document-storage.service';
import { SpecializedDocumentsService } from './specialized-documents.service';
import { NoteBlocksService } from './note-blocks.service';
import { CreateNoteDto, UpdateNoteDto } from '../dto/note.dto';
import { CreateBlockDto, UpdateBlockDto, ReorderBlocksDto } from '../dto/block.dto';
import { Block } from '../entities/block.entity';

/**
 * Servicio de dominio para Gestión de Notas.
 * Actúa como orquestador de alto nivel aplicando Alta Cohesión:
 * - Delega la gestión de bloques a NoteBlocksService.
 * - Delega la persistencia física de documentos especializados a SpecializedDocumentsService.
 * - Gestiona la identidad, pertenencia a espacios y persistencia en MongoDB.
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly notesRepository: NotesRepository,
    private readonly storageService: DocumentStorageService,
    private readonly specializedDocsService: SpecializedDocumentsService,
    private readonly noteBlocksService: NoteBlocksService,
  ) {}

  /**
   * Obtiene la lista de notas de un usuario filtradas opcionalmente por espacio.
   * La vista resumida omite contenidos y lecturas de disco para la navegación inicial.
   */
  async getNotes(userId: string, space?: string, summaryOnly = false) {
    let notes = summaryOnly
      ? await this.notesRepository.findAllByUser(userId, space, true)
      : await this.notesRepository.findAllByUser(userId, space);
    if (notes.length === 0 && (!space || space === 'all' || space === 'Research')) {
      if (!(await this.notesRepository.hasNotes(userId))) {
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

    if (summaryOnly) {
      return notes.map(note => {
        const value = note.toObject ? note.toObject() : note;
        const { blocks, docData, ...summary } = value;
        return summary;
      });
    }

    return Promise.all(
      notes.map(async (n) => {
        const noteObj: any = (n as any).toObject ? (n as any).toObject() : JSON.parse(JSON.stringify(n));
        return this.specializedDocsService.hydrateDocument(noteObj);
      }),
    );
  }

  /**
   * Obtiene un documento de nota por su identificador.
   * Hidrata asíncronamente 'docData' a través del servicio especializado.
   */
  async getNoteById(id: string, userId: string) {
    const note = await this.notesRepository.findByIdAndUser(id, userId);
    if (!note) {
      throw new NotFoundException('Note not found');
    }

    const noteObj: any = (note as any).toObject ? (note as any).toObject() : JSON.parse(JSON.stringify(note));
    return this.specializedDocsService.hydrateDocument(noteObj);
  }

  /**
   * Crea una nueva nota. Si es especializada ('sheet', 'doc', 'canvas', 'slide'),
   * delega la escritura física en disco al servicio especializado.
   */
  async createNote(userId: string, createNoteDto: CreateNoteDto) {
    const docType = createNoteDto.docType || 'block';
    const noteId = new Types.ObjectId();
    const noteIdStr = noteId.toString();

    let docUrl: string | null = null;
    let initialDocData: any = null;

    if (docType !== 'block' && docType !== 'latex') {
      const result = await this.specializedDocsService.createSpecializedDocument(
        noteIdStr,
        docType,
        createNoteDto.title,
        createNoteDto.docData,
      );
      docUrl = result.docUrl;
      initialDocData = result.initialDocData;
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
      docData: docType === 'latex' ? this.latexData(createNoteDto.docData) : null,
      tags: createNoteDto.tags ?? [],
      blocks: initialBlocks,
    });

    const createdObj: any = (created as any).toObject ? (created as any).toObject() : JSON.parse(JSON.stringify(created));
    if (docType !== 'block' && docType !== 'latex') {
      createdObj.docData = initialDocData;
    }
    return createdObj;
  }

  /**
   * Actualiza el contenido y metadatos de un documento.
   * Persiste de forma asíncrona datos especializados a través de SpecializedDocumentsService.
   */
  async updateNote(id: string, userId: string, updateNoteDto: UpdateNoteDto) {
    const note = await this.notesRepository.findByIdAndUser(id, userId);
    if (!note) {
      throw new NotFoundException('Note not found');
    }

    const effectiveDocType = updateNoteDto.docType || note.docType || 'block';
    let memoryDocData: any = undefined;
    if (effectiveDocType === 'latex' && updateNoteDto.docData !== undefined) {
      updateNoteDto.docData = this.latexData(updateNoteDto.docData);
    }

    if (effectiveDocType !== 'block' && effectiveDocType !== 'latex') {
      if (updateNoteDto.docData !== undefined && updateNoteDto.docData !== null) {
        const result = await this.specializedDocsService.updateSpecializedDocument(
          id,
          effectiveDocType,
          updateNoteDto.docData,
          updateNoteDto.title,
        );
        if (result.docUrl) {
          updateNoteDto.docUrl = result.docUrl;
        }
        memoryDocData = result.memoryDocData;
        updateNoteDto.docData = null;
      } else if (updateNoteDto.title && effectiveDocType !== 'slide') {
        const existingData = await this.specializedDocsService.readSpecializedDocument(id, effectiveDocType);
        if (existingData && typeof existingData === 'object') {
          existingData.title = updateNoteDto.title;
          await this.specializedDocsService.updateSpecializedDocument(id, effectiveDocType, existingData);
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

    const resultObj: any = (updated as any).toObject ? (updated as any).toObject() : JSON.parse(JSON.stringify(updated));
    if (effectiveDocType !== 'block' && effectiveDocType !== 'latex') {
      if (memoryDocData !== undefined) {
        resultObj.docData = memoryDocData;
      } else {
        resultObj.docData = await this.specializedDocsService.readSpecializedDocument(id, effectiveDocType);
      }
    }
    return resultObj;
  }

  /**
   * Elimina un documento de nota y borra sus archivos asociados de forma asíncrona.
   */
  async deleteNote(id: string, userId: string) {
    const note = await this.notesRepository.findByIdAndUser(id, userId);
    if (!note) {
      throw new NotFoundException('Note not found');
    }

    if (note.docType && note.docType !== 'block' && note.docType !== 'latex') {
      await this.specializedDocsService.deleteSpecializedDocument(id, note.docType);
    }

    const deleted = await this.notesRepository.delete(id, userId);
    if (!deleted) {
      throw new NotFoundException('Note not found');
    }
    return { success: true, message: 'Note deleted successfully' };
  }

  private latexData(data: unknown): { version: number; source: string } {
    if (data == null) return { version: 1, source: '' };
    const source = (data as { source?: unknown }).source;
    if (typeof source !== 'string' || source.length > 300_000) {
      throw new BadRequestException('El documento LaTeX debe contener source (máximo 300 000 caracteres).');
    }
    return { version: 1, source };
  }

  // --- Métodos de delegación de Bloques (NoteBlocksService) para compatibilidad hacia atrás ---

  async addBlock(noteId: string, userId: string, createBlockDto: CreateBlockDto) {
    return this.noteBlocksService.addBlock(noteId, userId, createBlockDto);
  }

  async updateBlock(
    noteId: string,
    blockId: string,
    userId: string,
    updateBlockDto: UpdateBlockDto,
  ) {
    return this.noteBlocksService.updateBlock(noteId, blockId, userId, updateBlockDto);
  }

  async removeBlock(noteId: string, blockId: string, userId: string) {
    return this.noteBlocksService.removeBlock(noteId, blockId, userId);
  }

  async reorderBlocks(
    noteId: string,
    userId: string,
    reorderDto: ReorderBlocksDto,
  ) {
    return this.noteBlocksService.reorderBlocks(noteId, userId, reorderDto);
  }
}
