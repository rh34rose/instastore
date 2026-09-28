import type { FC } from 'hono/jsx';
import { formatMoney } from '../../money';
import type { Product, Settings } from '../../types';

export const Price: FC<{ amount: number; settings: Settings; class?: string }> = (props) => (
  <span class={props.class}>{formatMoney(props.amount, props.settings.currency, props.settings.locale)}</span>
);

export const ProductPrice: FC<{ product: Pick<Product, 'price' | 'compareAtPrice'>; settings: Settings }> = ({ product, settings }) => (
  <span class="price">
    <Price amount={product.price} settings={settings} />
    {product.compareAtPrice !== null && product.compareAtPrice > product.price ? (
      <s class="compare-at">
        <Price amount={product.compareAtPrice} settings={settings} />
      </s>
    ) : null}
  </span>
);

export const ProductImage: FC<{ imageId: string | null | undefined; alt: string; class?: string; sizes?: string }> = (props) =>
  props.imageId ? (
    <img src={`/img/${props.imageId}`} alt={props.alt} class={props.class} loading="lazy" />
  ) : (
    <div class={`no-image ${props.class ?? ''}`} aria-hidden="true">
      <span>No photo</span>
    </div>
  );

export const ProductCard: FC<{ product: Product; settings: Settings }> = ({ product, settings }) => (
  <a href={`/p/${product.slug}`} class={`card${product.inStock ? '' : ' sold-out'}`}>
    <div class="card-media">
      <ProductImage imageId={product.imageIds[0]} alt={product.name} />
      {!product.inStock ? <span class="ribbon">Sold out</span> : null}
    </div>
    <div class="card-body">
      <h3>{product.name}</h3>
      <ProductPrice product={product} settings={settings} />
    </div>
  </a>
);

export const ProductGrid: FC<{ products: Product[]; settings: Settings; emptyText?: string }> = ({ products, settings, emptyText }) =>
  products.length === 0 ? (
    <p class="empty">{emptyText ?? 'No products here yet.'}</p>
  ) : (
    <div class="grid">
      {products.map((p) => (
        <ProductCard product={p} settings={settings} />
      ))}
    </div>
  );

export const Notice: FC<{ kind?: 'info' | 'success' | 'error'; children?: unknown }> = ({ kind = 'info', children }) => (
  <div class={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    {children}
  </div>
);
