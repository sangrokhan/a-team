import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class ListTeamMailboxQueryDto {
  @ApiPropertyOptional({
    description: 'Return messages with sequence greater than this value',
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  after?: number;
}
