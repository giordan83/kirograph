export class Validator {
  validate(value: string): boolean {
    if (!value) return false;
    if (value.length > 1000) return false;
    return true;
  }
  validateEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
  validatePhone(phone: string): boolean {
    return /^\+?[\d\s\-()]{7,}$/.test(phone);
  }
}
