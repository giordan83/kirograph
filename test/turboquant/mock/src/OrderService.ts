import { ProductCatalogue } from './models/Product';
import { PaymentService } from './services/PaymentService';
import { NotificationService } from './services/NotificationService';

/** Manages the complete order lifecycle from cart to delivery. */
export class OrderService {
  constructor(
    private readonly catalogue: ProductCatalogue,
    private readonly payments: PaymentService,
    private readonly notifications: NotificationService,
  ) {}

  /** Place a new order and process payment for the given product. */
  async placeOrder(userId: string, productId: string, quantity: number, cardToken: string) {
    if (!this.catalogue.isInStock(productId)) {
      throw new Error('Product out of stock');
    }
    const products = this.catalogue.search(productId);
    const product = products[0];
    if (!product) throw new Error('Product not found');

    const payment = await this.payments.chargeCard(cardToken, product, quantity);
    if (payment.status !== 'approved') throw new Error('Payment declined');

    this.catalogue.decrementStock(productId, quantity);
    this.notifications.sendEmail(userId, 'Order confirmed', `Transaction: ${payment.transactionId}`);
    return payment;
  }

  /** Cancel an existing order and issue a refund. */
  async cancelOrder(userId: string, transactionId: string, amount: number): Promise<void> {
    await this.payments.refund(transactionId, amount);
    this.notifications.sendPush(userId, 'Your order has been cancelled and refunded.');
  }
}
