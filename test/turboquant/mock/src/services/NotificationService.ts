/** Notification delivery channel options. */
export type NotificationChannel = 'email' | 'sms' | 'push';

/** Sends alerts and messages to users via multiple channels. */
export class NotificationService {
  private queue: Array<{ userId: string; message: string; channel: NotificationChannel }> = [];

  /** Queue an email notification for a user. */
  sendEmail(userId: string, subject: string, body: string): void {
    this.queue.push({ userId, message: `${subject}: ${body}`, channel: 'email' });
  }

  /** Queue a push notification for a mobile device. */
  sendPush(userId: string, message: string): void {
    this.queue.push({ userId, message, channel: 'push' });
  }

  /** Flush the queue and deliver all pending notifications. */
  async flushQueue(): Promise<number> {
    const count = this.queue.length;
    this.queue = [];
    return count;
  }
}
