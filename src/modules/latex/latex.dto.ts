import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CompileLatexDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300_000)
  source: string;

  @IsOptional()
  @IsIn(['document', 'fragment'])
  mode?: 'document' | 'fragment';
}
