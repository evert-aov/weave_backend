import { Test, TestingModule } from '@nestjs/testing';
import { NotesService } from './notes.service';
import { NotesRepository } from '../repositories/notes.repository';
import { NotFoundException } from '@nestjs/common';

describe('NotesService', () => {
  let service: NotesService;
  let notesRepository: Partial<NotesRepository>;

  const mockNote = {
    _id: 'note-1',
    userId: 'user-1',
    title: 'Test Note',
    lead: 'Test lead',
    space: 'Research',
    tags: ['ai'],
    blocks: [
      {
        id: 'b-1',
        type: 'text' as const,
        order: 0,
        content: { html: '<p>Hello</p>' },
        metadata: {},
      },
    ],
  };

  beforeEach(async () => {
    notesRepository = {
      findAllByUser: jest.fn().mockResolvedValue([mockNote]),
      findByIdAndUser: jest.fn().mockResolvedValue(mockNote),
      create: jest.fn().mockResolvedValue(mockNote),
      update: jest.fn().mockImplementation((id, userId, data) =>
        Promise.resolve({ ...mockNote, ...data }),
      ),
      delete: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotesService,
        { provide: NotesRepository, useValue: notesRepository },
      ],
    }).compile();

    service = module.get<NotesService>(NotesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should get notes by user', async () => {
    const notes = await service.getNotes('user-1');
    expect(notes).toHaveLength(1);
    expect(notesRepository.findAllByUser).toHaveBeenCalledWith('user-1', undefined);
  });

  it('should create note with default block when none provided', async () => {
    await service.createNote('user-1', {
      title: 'New Note',
    });
    expect(notesRepository.create).toHaveBeenCalled();
  });

  it('should add a block to note', async () => {
    const updated = await service.addBlock('note-1', 'user-1', {
      id: 'b-2',
      type: 'latex',
      content: { formula: 'E=mc^2' },
    });
    expect(notesRepository.update).toHaveBeenCalled();
  });

  it('should throw NotFoundException if note not found on delete', async () => {
    (notesRepository.delete as jest.Mock).mockResolvedValue(false);
    await expect(service.deleteNote('invalid-id', 'user-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
