import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { SpacesService } from '../services/spaces.service';
import { CreateSpaceDto, UpdateSpaceDto } from '../dto/space.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

/**
 * Controlador de Espacios (Directorios).
 * Expone endpoints REST para listar, crear, editar y eliminar directorios de notas.
 */
@UseGuards(JwtAuthGuard)
@Controller('api/spaces')
export class SpacesController {
  constructor(private readonly spacesService: SpacesService) {}

  /**
   * Obtiene la lista de todos los espacios/directorios del usuario actual en MongoDB.
   */
  @Get()
  async getSpaces(@CurrentUser('id') userId: string) {
    return this.spacesService.getSpaces(userId);
  }

  /**
   * Crea un nuevo espacio/directorio en MongoDB.
   */
  @Post()
  async createSpace(
    @CurrentUser('id') userId: string,
    @Body() createSpaceDto: CreateSpaceDto,
  ) {
    return this.spacesService.createSpace(userId, createSpaceDto);
  }

  /**
   * Actualiza el nombre o propiedades de un espacio.
   */
  @Put(':id')
  async updateSpace(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() updateSpaceDto: UpdateSpaceDto,
  ) {
    return this.spacesService.updateSpace(id, userId, updateSpaceDto);
  }

  /**
   * Elimina un espacio/directorio.
   */
  @Delete(':id')
  async deleteSpace(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.spacesService.deleteSpace(id, userId);
  }
}
