import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export type DashboardPeriod = 'today' | 'week' | 'mtd';

export class DashboardPeriodQueryDto {
  @IsOptional()
  @IsIn(['today', 'week', 'mtd'])
  period: DashboardPeriod = 'today';
}

export class TopVariantsQueryDto extends DashboardPeriodQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit: number = 5;
}

export interface PeriodDateRange {
  startDate: Date;
  endDate: Date;
  period: DashboardPeriod;
}

/**
 * Computes exact start and end date boundaries in Pakistan Standard Time (PKT, UTC+5).
 * - today: 00:00:00 PKT today to now
 * - week: Monday 00:00:00 PKT of current week to now
 * - mtd: 1st of current month 00:00:00 PKT to now
 */
export function getPeriodDateRange(period: DashboardPeriod = 'today'): PeriodDateRange {
  const now = new Date();
  const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC+5
  const pktNow = new Date(now.getTime() + PKT_OFFSET_MS);

  const year = pktNow.getUTCFullYear();
  const month = pktNow.getUTCMonth();
  const date = pktNow.getUTCDate();
  const day = pktNow.getUTCDay(); // 0 = Sunday, 1 = Monday, ...

  let startUtcMs: number;

  switch (period) {
    case 'today':
      startUtcMs = Date.UTC(year, month, date, 0, 0, 0, 0) - PKT_OFFSET_MS;
      break;

    case 'week': {
      // Current week starting from Monday 00:00:00 PKT
      const diffToMonday = day === 0 ? 6 : day - 1;
      startUtcMs = Date.UTC(year, month, date - diffToMonday, 0, 0, 0, 0) - PKT_OFFSET_MS;
      break;
    }

    case 'mtd':
      // 1st of current month 00:00:00 PKT
      startUtcMs = Date.UTC(year, month, 1, 0, 0, 0, 0) - PKT_OFFSET_MS;
      break;

    default:
      startUtcMs = Date.UTC(year, month, date, 0, 0, 0, 0) - PKT_OFFSET_MS;
      break;
  }

  return {
    startDate: new Date(startUtcMs),
    endDate: now,
    period,
  };
}
