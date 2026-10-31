import { Body, Controller, Module, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CompileLatexDto } from './latex.dto';
import { LatexRunner, LatexService } from './latex.service';

@UseGuards(JwtAuthGuard)
@Controller('api/latex')
export class LatexController {
  constructor(private readonly latex: LatexService) {}
  @Post('compile')
  compile(@CurrentUser('id') userId: string, @Body() dto: CompileLatexDto) {
    return this.latex.compile(userId, dto);
  }
}

@Module({ controllers: [LatexController], providers: [LatexRunner, LatexService] })
export class LatexModule {}
