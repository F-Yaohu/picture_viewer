import type { Picture } from '../db/db';

export interface LayoutItem {
  item: Picture;
  width: number;
  height: number;
}

export interface GroupedLayout {
  label: string;
  rows: LayoutItem[][];
}

/**
 * Calculate justified rows layout for a group of pictures
 * @param pictures - Array of pictures to layout
 * @param containerWidth - Available width for layout
 * @param rowHeight - Target height for each row
 * @param gap - Gap between items in pixels
 * @returns Array of rows with calculated dimensions
 */
export function calculateJustifiedRows(
  pictures: Picture[],
  containerWidth: number,
  rowHeight: number,
  gap: number
): LayoutItem[][] {
  const effectiveContainerWidth = Math.max(100, containerWidth) - 1;
  const rows: LayoutItem[][] = [];
  let currentRow: LayoutItem[] = [];
  let currentRowWidth = 0;

  for (const picture of pictures) {
    const ratio = (picture.width && picture.height) 
      ? (picture.width / picture.height) 
      : 1.6; // Default aspect ratio
    const width = ratio * rowHeight;
    
    currentRow.push({ item: picture, width, height: rowHeight });
    currentRowWidth += width + gap;

    // Row is full, finalize it
    if (currentRowWidth - gap >= effectiveContainerWidth) {
      const totalWidth = currentRow.reduce((sum, it) => sum + it.width, 0);
      const gapsTotal = (currentRow.length - 1) * gap;
      const scale = (effectiveContainerWidth - gapsTotal) / totalWidth;
      const finalHeight = Math.max(40, Math.round(rowHeight * scale));
      
      const finalizedRow = currentRow.map(it => ({
        item: it.item,
        width: Math.round(it.width * scale),
        height: finalHeight
      }));
      
      rows.push(finalizedRow);
      currentRow = [];
      currentRowWidth = 0;
    }
  }

  // Handle remaining items in last row
  if (currentRow.length > 0) {
    const totalWidth = currentRow.reduce((sum, it) => sum + it.width, 0);
    const gapsTotal = (currentRow.length - 1) * gap;
    const scale = Math.min(1, (effectiveContainerWidth - gapsTotal) / totalWidth);
    const finalHeight = Math.max(40, Math.round(rowHeight * scale));
    
    const finalizedRow = currentRow.map(it => ({
      item: it.item,
      width: Math.round(it.width * scale),
      height: finalHeight
    }));
    
    rows.push(finalizedRow);
  }

  return rows;
}

/**
 * Group pictures by date and calculate justified layout for each group
 * @param pictures - Array of all pictures
 * @param containerWidth - Available width for layout
 * @param rowHeight - Target height for each row
 * @param gap - Gap between items in pixels
 * @param groupBy - Grouping granularity: 'day', 'week', or 'month'
 * @returns Array of grouped layouts with labels
 */
export function groupAndLayoutPictures(
  pictures: Picture[],
  containerWidth: number,
  rowHeight: number,
  gap: number,
  groupBy: 'day' | 'week' | 'month' = 'day'
): GroupedLayout[] {
  if (!pictures || pictures.length === 0 || !containerWidth) {
    return [];
  }

  // Group pictures by date
  const groupsMap = new Map<string, Picture[]>();
  for (const picture of pictures) {
    const key = formatGroupKey(picture.modified, groupBy);
    const arr = groupsMap.get(key) || [];
    arr.push(picture);
    groupsMap.set(key, arr);
  }

  // Calculate layout for each group
  const result: GroupedLayout[] = [];
  for (const groupPictures of groupsMap.values()) {
    const rows = calculateJustifiedRows(groupPictures, containerWidth, rowHeight, gap);
    const label = new Date(groupPictures[0].modified).toLocaleDateString();
    result.push({ label, rows });
  }

  return result;
}

/**
 * Format group key based on timestamp and grouping granularity
 */
function formatGroupKey(timestamp: number, groupBy: 'day' | 'week' | 'month'): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  if (groupBy === 'month') {
    return `${year}-${month}`;
  }

  if (groupBy === 'week') {
    // ISO week number calculation
    const tmp = new Date(Date.UTC(year, date.getMonth(), date.getDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  // Default: day
  return `${year}-${month}-${day}`;
}
