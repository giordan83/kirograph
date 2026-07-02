/** A purchasable product in the catalogue. */
export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
}

/** Manages product catalogue and inventory. */
export class ProductCatalogue {
  private products: Product[] = [];

  /** Search products by category or keyword. */
  search(query: string): Product[] {
    const q = query.toLowerCase();
    return this.products.filter(p =>
      p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
    );
  }

  /** Check if a product is available for purchase. */
  isInStock(productId: string): boolean {
    const p = this.products.find(p => p.id === productId);
    return p ? p.stock > 0 : false;
  }

  /** Decrement inventory after a sale transaction. */
  decrementStock(productId: string, quantity: number): void {
    const p = this.products.find(p => p.id === productId);
    if (p) p.stock = Math.max(0, p.stock - quantity);
  }
}
