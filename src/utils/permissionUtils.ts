/**
 * Verifies permission for a given FileSystemHandle.
 *
 * @param handle The FileSystemHandle (file or directory) to verify.
 * @param withWrite Wether to request write permissions. Default is false (read-only).
 * @returns True if permission is granted, false otherwise.
 */
async function verifyHandlePermission(handle: FileSystemHandle, withWrite = false): Promise<boolean> {
  const options: FileSystemHandlePermissionDescriptor = withWrite ? { mode: 'readwrite' } : { mode: 'read' };
  
  // Check if permission is already granted
  if ((await handle.queryPermission(options)) === 'granted') {
    return true;
  }
  
  // Request permission
  if ((await handle.requestPermission(options)) === 'granted') {
    return true;
  }

  // Permission was not granted
  return false;
}

export { verifyHandlePermission };
