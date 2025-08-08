import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { DataSource } from '../../db/db';

export type SerializableDataSource = Omit<DataSource, 'path'> & { path: string };

interface DataSourcesState {
  sources: SerializableDataSource[];
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
  error: string | null;
}

const initialState: DataSourcesState = {
  sources: [],
  status: 'idle',
  error: null,
};

const dataSourceSlice = createSlice({
  name: 'dataSources',
  initialState,
  reducers: {
    setSources(state, action: PayloadAction<DataSource[]>) {
      state.sources = action.payload.map(ds => ({ ...ds, path: ds.name }));
      state.status = 'succeeded';
    },
    addSource(state, action: PayloadAction<DataSource>) {
      state.sources.push({ ...action.payload, path: action.payload.name });
    },
    updateSource(state, action: PayloadAction<DataSource>) {
      const index = state.sources.findIndex(s => s.id === action.payload.id);
      if (index !== -1) {
        state.sources[index] = { ...action.payload, path: action.payload.name };
      }
    },
    removeSource(state, action: PayloadAction<number>) {
      state.sources = state.sources.filter(s => s.id !== action.payload);
    }
  },
});

export const { setSources, addSource, updateSource, removeSource } = dataSourceSlice.actions;
export default dataSourceSlice.reducer;
