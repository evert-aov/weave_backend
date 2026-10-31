import { Injectable, NotFoundException } from '@nestjs/common';
import { NotesRepository } from '../repositories/notes.repository';
import { CreateBlockDto, UpdateBlockDto, ReorderBlocksDto } from '../dto/block.dto';
import { Block } from '../entities/block.entity';

/**
 * Servicio especializado en la gestión del ciclo de vida de bloques para notas "todo en uno".
 * Aplica Alta Cohesión aislando la manipulación, normalización de orden y mutaciones de bloques.
 */
@Injectable()
export class NoteBlocksService {
  constructor(private readonly notesRepository: NotesRepository) {}

  /**
   * Añade un nuevo bloque al documento en la posición indicada.
   */
  async addBlock(noteId: string, userId: string, createBlockDto: CreateBlockDto) {
    const note = await this.notesRepository.findByIdAndUser(noteId, userId);
    if (!note) {
      throw new NotFoundException('Note not found');
    }

    const currentBlocks = (note.blocks || []) as Block[];
    const newOrder =
      createBlockDto.order !== undefined
        ? createBlockDto.order
        : currentBlocks.length;

    const newBlock: Block = {
      id: createBlockDto.id,
      type: createBlockDto.type,
      order: newOrder,
      content: createBlockDto.content ?? {},
      metadata: createBlockDto.metadata ?? {},
    };

    const updatedBlocks = [...currentBlocks];
    updatedBlocks.splice(newOrder, 0, newBlock);

    // Normalizar orden secuencial de los bloques
    updatedBlocks.forEach((block, index) => {
      block.order = index;
    });

    return this.notesRepository.update(noteId, userId, { blocks: updatedBlocks });
  }

  /**
   * Actualiza el contenido o metadatos de un bloque existente.
   */
  async updateBlock(
    noteId: string,
    blockId: string,
    userId: string,
    updateBlockDto: UpdateBlockDto,
  ) {
    const note = await this.notesRepository.findByIdAndUser(noteId, userId);
    if (!note) {
      throw new NotFoundException('Note not found');
    }

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
   * Elimina un bloque específico del documento y renombra los órdenes secuenciales.
   */
  async removeBlock(noteId: string, blockId: string, userId: string) {
    const note = await this.notesRepository.findByIdAndUser(noteId, userId);
    if (!note) {
      throw new NotFoundException('Note not found');
    }

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
    const note = await this.notesRepository.findByIdAndUser(noteId, userId);
    if (!note) {
      throw new NotFoundException('Note not found');
    }

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
