import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { jobStatuses, modes } from '../job.types';

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => (typeof item === 'string' ? item.split(',') : []))
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return [];
}

export class ListJobsQueryDto {
  @ApiPropertyOptional({
    isArray: true,
    description: 'Filter by one or more statuses.',
    enum: jobStatuses,
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsEnum(jobStatuses, { each: true })
  statuses?: (typeof jobStatuses)[number][];

  @ApiPropertyOptional({
    isArray: true,
    description: 'Filter by one or more modes.',
    enum: modes,
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsEnum(modes, { each: true })
  modes?: (typeof modes)[number][];

  @ApiPropertyOptional({
    description: 'Maximum number of records to return.',
    minimum: 1,
    maximum: 2000,
    default: 200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Only return jobs updated at or after this ISO timestamp.',
    example: '2026-02-20T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  updatedAfter?: string;
}
