export type ExportUrlKind = 'telemetry' | 'track';

export function exportUrlForDroppedFileName(fileName: string, kind: ExportUrlKind): string {
  const baseName = fileName.split(/[\\/]/).pop() ?? fileName;
  const lower = baseName.toLowerCase();

  if (
    kind === 'track' &&
    (lower.endsWith('_enriched.geojson') || lower.endsWith('_enriched.gpx'))
  ) {
    return `/output/${encodeURIComponent(baseName)}`;
  }

  return '';
}
