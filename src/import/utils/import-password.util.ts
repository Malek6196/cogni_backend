import { ImportRowError } from '../interfaces';

const MIN_IMPORT_PASSWORD_LENGTH = 6;

export function validateImportPassword(
  password: string | undefined,
  row: number,
  field = 'password',
): ImportRowError | null {
  if (!password) {
    return {
      row,
      field,
      message: 'Missing password for new user',
    };
  }

  if (password.length < MIN_IMPORT_PASSWORD_LENGTH) {
    return {
      row,
      field,
      message: `Password must be at least ${MIN_IMPORT_PASSWORD_LENGTH} characters`,
    };
  }

  return null;
}
