import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersRepository } from '../repositories/users.repository';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

describe('AuthService', () => {
  let service: AuthService;
  let usersRepository: Partial<UsersRepository>;
  let jwtService: Partial<JwtService>;

  beforeEach(async () => {
    usersRepository = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('mock_jwt_token'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersRepository, useValue: usersRepository },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('should throw BadRequestException if user already exists', async () => {
      (usersRepository.findByEmail as jest.Mock).mockResolvedValue({ id: '1' });

      await expect(
        service.register({
          name: 'Alex',
          email: 'alex@weave.so',
          password: 'password123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully register and return token and user profile', async () => {
      (usersRepository.findByEmail as jest.Mock).mockResolvedValue(null);
      (usersRepository.create as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'user-123' },
        name: 'Alex Morgan',
        email: 'alex@weave.so',
        avatar: 'avatar_url',
      });

      const result = await service.register({
        name: 'Alex Morgan',
        email: 'alex@weave.so',
        password: 'password123',
      });

      expect(result.accessToken).toBe('mock_jwt_token');
      expect(result.user.name).toBe('Alex Morgan');
      expect(result.user.email).toBe('alex@weave.so');
    });
  });

  describe('login', () => {
    it('should throw UnauthorizedException if user not found', async () => {
      (usersRepository.findByEmail as jest.Mock).mockResolvedValue(null);

      await expect(
        service.login({ email: 'unknown@weave.so', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password does not match', async () => {
      const hashedPassword = await bcrypt.hash('correct_password', 10);
      (usersRepository.findByEmail as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'user-123' },
        email: 'alex@weave.so',
        password: hashedPassword,
      });

      await expect(
        service.login({ email: 'alex@weave.so', password: 'wrong_password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return token if credentials are valid', async () => {
      const hashedPassword = await bcrypt.hash('secret123', 10);
      (usersRepository.findByEmail as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'user-123' },
        name: 'Alex Morgan',
        email: 'alex@weave.so',
        password: hashedPassword,
        avatar: 'avatar_url',
      });

      const result = await service.login({
        email: 'alex@weave.so',
        password: 'secret123',
      });

      expect(result.accessToken).toBe('mock_jwt_token');
      expect(result.user.email).toBe('alex@weave.so');
    });
  });
});
