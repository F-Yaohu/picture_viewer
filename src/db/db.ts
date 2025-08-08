import Dexie, { type Table } from 'dexie';

export interface RemoteConfig {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string; // JSON string
  responsePath: string; // Dot notation path to the array of images
  fieldMapping: {
    url: string;
    name: string;
    modified?: string;
  };
  maxImages?: number;
  baseURL?: string;
}

// Define the structure of a data source (e.g., local folder, remote API)
export interface DataSource {
  id?: number;
  type: 'local' | 'remote';
  name: string;
  path: any; // Can be a string for remote or a FileSystemHandle for local
  enabled: number; // 1 for true, 0 for false
  includeSubfolders?: boolean;
  pictureCount?: number; // Optional: to store the count of pictures
  remoteConfig?: RemoteConfig;
}

// Define the structure of a picture's metadata
export interface Picture {
  id?: number;
  sourceId: number; // Foreign key to the DataSource
  name: string;
  path: any; // FileSystemFileHandle for local files OR string URL for remote
  modified: number; // Last modified date as a timestamp for sorting
  size?: number;
  width?: number;
  height?: number;
}

export class PictureViewerDB extends Dexie {
  dataSources!: Table<DataSource>;
  pictures!: Table<Picture>;

  constructor() {
    super('pictureViewerDB');
    this.version(4).stores({
      // Added pictureCount to the dataSources table
      dataSources: '++id, name, type, enabled',
      pictures: '++id, sourceId, path, [modified+name]',
    });
    this.version(5).stores({
      // Added a compound index for efficient filtering and sorting.
      pictures: '++id, sourceId, path, [modified+name], [sourceId+modified]',
    });
    this.version(6).stores({
      // Added an index for the name field for efficient searching.
      pictures: '++id, name, sourceId, path, [modified+name], [sourceId+modified]',
    });
    this.version(7).stores({
      // Added remoteConfig to dataSources. No index needed for this object.
      dataSources: '++id, name, type, enabled, remoteConfig',
    });
    this.version(8).stores({
      // No schema changes, just ensuring remoteConfig properties are updated.
      // Dexie handles additive changes to interfaces automatically.
    });
    this.version(9).stores({}); // For baseURL addition
  }
}

// Export a single instance of the database
export const db = new PictureViewerDB();
