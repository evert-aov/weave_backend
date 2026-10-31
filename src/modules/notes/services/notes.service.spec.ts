import { Test, TestingModule } from '@nestjs/testing';
import { NotesService } from './notes.service';
import { NotesRepository } from '../repositories/notes.repository';
import { DocumentStorageService } from './document-storage.service';
import { SpecializedDocumentsService } from './specialized-documents.service';
import { NoteBlocksService } from './note-blocks.service';
import { NotFoundException } from '@nestjs/common';

describe('NotesService', () => {
  let service: NotesService;
  let notesRepository: Partial<NotesRepository>;
  let storageService: Partial<DocumentStorageService>;
  let specializedDocsService: Partial<SpecializedDocumentsService>;
  let noteBlocksService: Partial<NoteBlocksService>;

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
      hasNotes: jest.fn().mockResolvedValue(true),
      findByIdAndUser: jest.fn().mockResolvedValue(mockNote),
      create: jest.fn().mockResolvedValue(mockNote),
      update: jest.fn().mockImplementation((id, userId, data) =>
        Promise.resolve({ ...mockNote, ...data }),
      ),
      delete: jest.fn().mockResolvedValue(true),
    };

    storageService = {
      saveDocument: jest.fn().mockResolvedValue('/uploads/documents/note-1_sheet.json'),
      readDocument: jest.fn().mockResolvedValue({}),
      savePptx: jest.fn().mockResolvedValue('/uploads/documents/note-1.pptx'),
      readPptxBase64: jest.fn().mockResolvedValue(''),
      deleteDocument: jest.fn().mockResolvedValue(undefined),
    };

    specializedDocsService = {
      hydrateDocument: jest.fn().mockImplementation((n) => Promise.resolve(n)),
      createSpecializedDocument: jest.fn().mockResolvedValue({
        docUrl: '/uploads/documents/note-1_sheet.json',
        initialDocData: {},
      }),
      updateSpecializedDocument: jest.fn().mockResolvedValue({
        docUrl: '/uploads/documents/note-1_sheet.json',
        memoryDocData: {},
      }),
      readSpecializedDocument: jest.fn().mockResolvedValue({}),
      deleteSpecializedDocument: jest.fn().mockResolvedValue(undefined),
    };

    noteBlocksService = {
      addBlock: jest.fn().mockResolvedValue(mockNote),
      updateBlock: jest.fn().mockResolvedValue(mockNote),
      removeBlock: jest.fn().mockResolvedValue(mockNote),
      reorderBlocks: jest.fn().mockResolvedValue(mockNote),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotesService,
        { provide: NotesRepository, useValue: notesRepository },
        { provide: DocumentStorageService, useValue: storageService },
        { provide: SpecializedDocumentsService, useValue: specializedDocsService },
        { provide: NoteBlocksService, useValue: noteBlocksService },
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

  it('should return navigation summaries without hydrating files or including editable data', async () => {
    (notesRepository.findAllByUser as jest.Mock).mockResolvedValue([
      { ...mockNote, docType: 'slide', docData: { base64: 'LARGE_PPTX_PAYLOAD' } },
    ]);
    const notes = await service.getNotes('user-1', 'Research', true);
    expect(notesRepository.findAllByUser).toHaveBeenCalledWith('user-1', 'Research', true);
    expect(specializedDocsService.hydrateDocument).not.toHaveBeenCalled();
    expect(notes[0]).toMatchObject({ _id: 'note-1', title: 'Test Note', docType: 'slide' });
    expect(notes[0]).not.toHaveProperty('blocks');
    expect(notes[0]).not.toHaveProperty('docData');
  });

  it('should keep full document loading available for existing consumers', async () => {
    await service.getNotes('user-1');
    expect(specializedDocsService.hydrateDocument).toHaveBeenCalledTimes(1);
    await service.getNoteById('note-1', 'user-1');
    expect(specializedDocsService.hydrateDocument).toHaveBeenCalledTimes(2);
  });

  it('should preserve the welcome note for new users without exposing its blocks in summary mode', async () => {
    (notesRepository.findAllByUser as jest.Mock).mockResolvedValue([]);
    (notesRepository.hasNotes as jest.Mock).mockResolvedValue(false);
    const notes = await service.getNotes('user-1', 'Research', true);
    expect(notesRepository.create).toHaveBeenCalledTimes(1);
    expect(notes).toHaveLength(1);
    expect(notes[0]).not.toHaveProperty('blocks');
    expect(specializedDocsService.hydrateDocument).not.toHaveBeenCalled();
  });

  it('should create note with default block when none provided', async () => {
    await service.createNote('user-1', {
      title: 'New Note',
    });
    expect(notesRepository.create).toHaveBeenCalled();
  });

  it('creates empty LaTeX documents in Mongo without a public source file', async () => {
    (notesRepository.create as jest.Mock).mockImplementation(data => Promise.resolve(data));
    const note = await service.createNote('user-1', { title:'Física', docType:'latex' });
    expect(note.docData).toEqual({version:1,source:''}); expect(note.blocks).toEqual([]);
    expect(note.docUrl).toBeUndefined(); expect(specializedDocsService.createSpecializedDocument).not.toHaveBeenCalled();
  });

  it('updates and clears LaTeX source in Mongo, preserving ownership and skipping specialized file storage', async () => {
    (notesRepository.findByIdAndUser as jest.Mock).mockResolvedValue({...mockNote,docType:'latex',docData:{version:1,source:'old'}});
    const source = '\\documentclass{article}\n\\begin{document}Texto\\end{document}';
    const note = await service.updateNote('note-1','user-1',{docData:{version:1,source}});
    expect(note.docData.source).toBe(source);
    expect(notesRepository.update).toHaveBeenCalledWith('note-1','user-1',expect.objectContaining({docData:{version:1,source}}));
    expect(specializedDocsService.updateSpecializedDocument).not.toHaveBeenCalled();
    const cleared = await service.updateNote('note-1','user-1',{docData:{source:''}}); expect(cleared.docData.source).toBe('');
    await service.deleteNote('note-1','user-1'); expect(specializedDocsService.deleteSpecializedDocument).not.toHaveBeenCalled();
    await expect(service.updateNote('note-1','user-1',{docData:{source:'x'.repeat(300001)}})).rejects.toThrow('máximo');
  });

  it('should add a block to note', async () => {
    const updated = await service.addBlock('note-1', 'user-1', {
      id: 'b-2',
      type: 'latex',
      content: { formula: 'E=mc^2' },
    });
    expect(updated).toBeDefined();
    expect(noteBlocksService.addBlock).toHaveBeenCalled();
  });

  it('should throw NotFoundException if note not found on delete', async () => {
    (notesRepository.delete as jest.Mock).mockResolvedValue(false);
    await expect(service.deleteNote('invalid-id', 'user-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
