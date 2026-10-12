import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { NotesRepository } from '../repositories/notes.repository';
import { CreateNoteDto, UpdateNoteDto } from '../dto/note.dto';
import { CreateBlockDto, UpdateBlockDto, ReorderBlocksDto } from '../dto/block.dto';
import { Block } from '../entities/block.entity';

/**
 * Servicio de dominio para Gestión de Notas y Bloques.
 * Implementa las reglas de negocio, ordenación y validaciones.
 */
@Injectable()
export class NotesService {
  constructor(private readonly notesRepository: NotesRepository) {}

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
    return notes;
  }

  /**
   * Obtiene un documento de nota por su identificador.
   */
  async getNoteById(id: string, userId: string) {
    const note = await this.notesRepository.findByIdAndUser(id, userId);
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    return note;
  }

  /**
   * Crea una nueva nota con bloques predeterminados si no se proporcionan.
   */
  async createNote(userId: string, createNoteDto: CreateNoteDto) {
    const docType = createNoteDto.docType || 'block';
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

    return this.notesRepository.create({
      userId: Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : (userId as any),
      title: createNoteDto.title,
      lead: createNoteDto.lead ?? '',
      space: createNoteDto.space ?? 'Research',
      docType: docType,
      docData: createNoteDto.docData ?? null,
      tags: createNoteDto.tags ?? [],
      blocks: initialBlocks,
    });
  }

  /**
   * Actualiza el contenido y metadatos de un documento.
   */
  async updateNote(id: string, userId: string, updateNoteDto: UpdateNoteDto) {
    const note = await this.notesRepository.findByIdAndUser(id, userId);
    if (!note) {
      throw new NotFoundException('Note not found');
    }

    const updated = await this.notesRepository.update(id, userId, {
      ...updateNoteDto,
      blocks: updateNoteDto.blocks !== undefined ? (updateNoteDto.blocks as Block[]) : note.blocks,
    });

    return updated;
  }

  /**
   * Elimina un documento de nota.
   */
  async deleteNote(id: string, userId: string) {
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
    const blockIndex = note.blocks.findIndex((b) => b.id === blockId);

    if (blockIndex === -1) {
      throw new NotFoundException('Block not found');
    }

    const currentBlock = note.blocks[blockIndex];
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

    const updatedBlocks = [...note.blocks];
    updatedBlocks[blockIndex] = updatedBlock;

    return this.notesRepository.update(noteId, userId, { blocks: updatedBlocks });
  }

  /**
   * Elimina un bloque específico del documento.
   */
  async removeBlock(noteId: string, blockId: string, userId: string) {
    const note = await this.getNoteById(noteId, userId);
    const updatedBlocks = note.blocks.filter((b) => b.id !== blockId);

    // Reordenar índices secuenciales
    updatedBlocks.forEach((block, index) => {
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
    const blockMap = new Map(note.blocks.map((b) => [b.id, b]));

    const reorderedBlocks: Block[] = [];
    reorderDto.blockIds.forEach((id, index) => {
      const block = blockMap.get(id);
      if (block) {
        block.order = index;
        reorderedBlocks.push(block);
        blockMap.delete(id);
      }
    });

    // Añadir cualquier bloque remanente al final
    blockMap.forEach((block) => {
      block.order = reorderedBlocks.length;
      reorderedBlocks.push(block);
    });

    return this.notesRepository.update(noteId, userId, {
      blocks: reorderedBlocks,
    });
  }
}
