import { configureStore } from '@reduxjs/toolkit';
import dataSourceReducer from './slices/dataSourceSlice';

export const store = configureStore({
  reducer: {
    dataSources: dataSourceReducer,
    // Add other reducers here as the app grows
  },
});

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
