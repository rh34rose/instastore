import type { FC } from 'hono/jsx';
import { formatMoney, toMajorString } from '../../money';
import type { Category, Product, Settings } from '../../types';
import { ProductImage } from '../store/components';
import { AdminPage, Checkbox, DeleteForm, EmptyState, Field, TextArea, TextInput, type AdminShell } from './layout';

// ───────────────────────── Categories ─────────────────────────

export interface CategoryFormValues {
  name: string;
  slug: string;
  description: string;
  sortOrder: string;
}

export type CategoryErrors = Partial<Record<keyof CategoryFormValues | 'image', string>>;

export const emptyCategoryValues: CategoryFormValues = { name: '', slug: '', description: '', sortOrder: '0' };

export function categoryToForm(c: Category): CategoryFormValues {
  return { name: c.name, slug: c.slug, description: c.description, sortOrder: String(c.sortOrder) };
}

const CategoryFields: FC<{ values: CategoryFormValues; errors: CategoryErrors; imageId: string | null }> = ({ values, errors, imageId }) => (
  <>
    <Field name="name" label="Name" error={errors.name}>
      <TextInput name="name" value={values.name} required maxlength={80} />
    </Field>
    <div class="field-row">
      <Field name="slug" label="URL slug" error={errors.slug} hint="Leave empty to generate from the name.">
        <TextInput name="slug" value={values.slug} maxlength={60} placeholder="auto" />
      </Field>
      <Field name="sortOrder" label="Sort order" hint="Lower numbers come first.">
        <TextInput name="sortOrder" value={values.sortOrder} type="number" />
      </Field>
    </div>
    <Field name="description" label="Description" hint="Optional. Shown at the top of the category page.">
      <TextArea name="description" value={values.description} rows={2} maxlength={1000} />
    </Field>
    <Field name="image" label="Image" error={errors.image} hint="Optional. Shown on the home page.">
      {imageId ? (
        <div class="logo-preview">
          <img src={`/img/${imageId}`} alt="" />
          <label class="check">
            <input type="checkbox" name="removeImage" /> <span>Remove image</span>
          </label>
        </div>
      ) : null}
      <input id="f-image" type="file" name="image" accept="image/*" data-resize="1200" />
    </Field>
  </>
);

export const CategoriesPage: FC<{ shell: AdminShell; categories: Category[]; counts: Map<string, number>; values: CategoryFormValues; errors: CategoryErrors }> = ({
  shell,
  categories,
  counts,
  values,
  errors,
}) => (
  <AdminPage shell={shell} title="Categories">
    <div class="two-col">
      <section>
        {categories.length === 0 ? (
          <EmptyState>No categories yet. Add one on the right — products can also live without a category.</EmptyState>
        ) : (
          <table class="table">
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>Products</th>
                <th>Order</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr>
                  <td class="thumb-cell">
                    <ProductImage imageId={cat.imageId} alt="" class="thumb-img" />
                  </td>
                  <td>
                    <a href={`/admin/categories/${cat.id}`}>{cat.name}</a>
                    <div class="muted small">/c/{cat.slug}</div>
                  </td>
                  <td>{counts.get(cat.id) ?? 0}</td>
                  <td>{cat.sortOrder}</td>
                  <td class="actions-cell">
                    <a href={`/admin/categories/${cat.id}`} class="btn btn-small">
                      Edit
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section class="panel">
        <h2>Add category</h2>
        <form method="post" action="/admin/categories" enctype="multipart/form-data">
          <CategoryFields values={values} errors={errors} imageId={null} />
          <button type="submit" class="btn btn-primary">
            Add category
          </button>
        </form>
      </section>
    </div>
  </AdminPage>
);

export const CategoryEditPage: FC<{ shell: AdminShell; category: Category; values: CategoryFormValues; errors: CategoryErrors; productCount: number }> = ({
  shell,
  category,
  values,
  errors,
  productCount,
}) => (
  <AdminPage shell={shell} title={`Edit category: ${category.name}`}>
    <p>
      <a href="/admin/categories">← All categories</a> · <a href={`/c/${category.slug}`} target="_blank" rel="noopener">View in store ↗</a>
    </p>
    <form method="post" action={`/admin/categories/${category.id}`} enctype="multipart/form-data" class="panel">
      <CategoryFields values={values} errors={errors} imageId={category.imageId} />
      <div class="actions">
        <button type="submit" class="btn btn-primary">
          Save
        </button>
      </div>
    </form>
    <div class="panel danger-zone">
      <h2>Delete</h2>
      <p class="muted small">
        {productCount > 0 ? `${productCount} product(s) in this category will stay in the store without a category.` : 'This category has no products.'}
      </p>
      <DeleteForm action={`/admin/categories/${category.id}/delete`} label="Delete category" confirm={`Delete category "${category.name}"?`} />
    </div>
  </AdminPage>
);

// ───────────────────────── Products ─────────────────────────

export interface ProductFormValues {
  name: string;
  slug: string;
  categoryId: string;
  price: string;
  compareAtPrice: string;
  description: string;
  inStock: boolean;
  featured: boolean;
  active: boolean;
  sortOrder: string;
}

export type ProductErrors = Partial<Record<keyof ProductFormValues | 'images', string>>;

export const emptyProductValues: ProductFormValues = {
  name: '',
  slug: '',
  categoryId: '',
  price: '',
  compareAtPrice: '',
  description: '',
  inStock: true,
  featured: false,
  active: true,
  sortOrder: '0',
};

export function productToForm(p: Product, currency: string): ProductFormValues {
  return {
    name: p.name,
    slug: p.slug,
    categoryId: p.categoryId ?? '',
    price: toMajorString(p.price, currency),
    compareAtPrice: p.compareAtPrice === null ? '' : toMajorString(p.compareAtPrice, currency),
    description: p.description,
    inStock: p.inStock,
    featured: p.featured,
    active: p.active,
    sortOrder: String(p.sortOrder),
  };
}

const ProductFields: FC<{ values: ProductFormValues; errors: ProductErrors; categories: Category[]; settings: Settings; imageIds: string[] }> = ({
  values,
  errors,
  categories,
  settings,
  imageIds,
}) => (
  <div class="two-col">
    <div>
      <section class="panel">
        <Field name="name" label="Name" error={errors.name}>
          <TextInput name="name" value={values.name} required maxlength={120} />
        </Field>
        <Field name="description" label="Description" hint="Blank lines start new paragraphs.">
          <TextArea name="description" value={values.description} rows={6} maxlength={5000} />
        </Field>
        <div class="field-row">
          <Field name="price" label={`Price (${settings.currency})`} error={errors.price}>
            <TextInput name="price" value={values.price} type="number" step="0.01" min="0" required />
          </Field>
          <Field name="compareAtPrice" label="Compare-at price" error={errors.compareAtPrice} hint="Optional. Shown struck through when higher than the price.">
            <TextInput name="compareAtPrice" value={values.compareAtPrice} type="number" step="0.01" min="0" />
          </Field>
        </div>
      </section>
      <section class="panel">
        <h2>Photos</h2>
        {imageIds.length > 0 ? (
          <ul class="image-list">
            {imageIds.map((id, i) => (
              <li>
                <img src={`/img/${id}`} alt={`Photo ${i + 1}`} />
                <label class="small">
                  <input type="radio" name="primaryImage" value={id} checked={i === 0} /> Main photo
                </label>
                <label class="small">
                  <input type="checkbox" name="removeImage" value={id} /> Remove
                </label>
              </li>
            ))}
          </ul>
        ) : null}
        <Field name="images" label={imageIds.length > 0 ? 'Add more photos' : 'Upload photos'} error={errors.images} hint="JPEG, PNG or WebP. Photos are resized in your browser before upload.">
          <input id="f-images" type="file" name="images" accept="image/*" multiple data-resize="1600" />
        </Field>
      </section>
    </div>
    <div>
      <section class="panel">
        <h2>Organisation</h2>
        <Field name="categoryId" label="Category">
          <select id="f-categoryId" name="categoryId">
            <option value="" selected={values.categoryId === ''}>
              — No category —
            </option>
            {categories.map((cat) => (
              <option value={cat.id} selected={values.categoryId === cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </Field>
        <Field name="slug" label="URL slug" error={errors.slug} hint="Leave empty to generate from the name.">
          <TextInput name="slug" value={values.slug} maxlength={60} placeholder="auto" />
        </Field>
        <Field name="sortOrder" label="Sort order" hint="Lower numbers come first.">
          <TextInput name="sortOrder" value={values.sortOrder} type="number" />
        </Field>
      </section>
      <section class="panel">
        <h2>Availability</h2>
        <Checkbox name="active" label="Visible in store" checked={values.active} hint="Untick to hide the product without deleting it." />
        <Checkbox name="inStock" label="In stock" checked={values.inStock} hint="Out-of-stock products are shown but cannot be ordered." />
        <Checkbox name="featured" label="Featured on home page" checked={values.featured} />
      </section>
    </div>
  </div>
);

export const ProductsPage: FC<{ shell: AdminShell; products: Product[]; categories: Category[]; categoryId: string; query: string }> = ({
  shell,
  products,
  categories,
  categoryId,
  query,
}) => {
  const { settings } = shell;
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  return (
    <AdminPage shell={shell} title="Products" wide>
      <div class="toolbar">
        <form method="get" action="/admin/products" class="inline">
          <input type="search" name="q" value={query} placeholder="Search by name" aria-label="Search products" />
          <select name="category" aria-label="Filter by category">
            <option value="" selected={categoryId === ''}>
              All categories
            </option>
            <option value="none" selected={categoryId === 'none'}>
              No category
            </option>
            {categories.map((cat) => (
              <option value={cat.id} selected={categoryId === cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
          <button type="submit" class="btn">
            Filter
          </button>
        </form>
        <a href="/admin/products/new" class="btn btn-primary">
          + Add product
        </a>
      </div>
      {products.length === 0 ? (
        <EmptyState>
          {query || categoryId ? 'No products match.' : (
            <>
              No products yet. <a href="/admin/products/new">Add your first product</a>.
            </>
          )}
        </EmptyState>
      ) : (
        <table class="table">
          <thead>
            <tr>
              <th></th>
              <th>Product</th>
              <th>Category</th>
              <th>Price</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr class={p.active ? '' : 'row-muted'}>
                <td class="thumb-cell">
                  <ProductImage imageId={p.imageIds[0]} alt="" class="thumb-img" />
                </td>
                <td>
                  <a href={`/admin/products/${p.id}`}>{p.name}</a>
                  <div class="muted small">/p/{p.slug}</div>
                </td>
                <td>{p.categoryId ? (categoryName.get(p.categoryId) ?? '—') : '—'}</td>
                <td>
                  {formatMoney(p.price, settings.currency, settings.locale)}
                  {p.compareAtPrice !== null ? <div class="muted small">was {formatMoney(p.compareAtPrice, settings.currency, settings.locale)}</div> : null}
                </td>
                <td class="pills">
                  {!p.active ? <span class="pill">Hidden</span> : null}
                  {!p.inStock ? <span class="pill pill-warn">Out of stock</span> : null}
                  {p.featured ? <span class="pill pill-accent">Featured</span> : null}
                  {p.active && p.inStock && !p.featured ? <span class="pill pill-ok">Live</span> : null}
                </td>
                <td class="actions-cell">
                  <a href={`/admin/products/${p.id}`} class="btn btn-small">
                    Edit
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AdminPage>
  );
};

export const ProductFormPage: FC<{ shell: AdminShell; product: Product | null; values: ProductFormValues; errors: ProductErrors; categories: Category[] }> = ({
  shell,
  product,
  values,
  errors,
  categories,
}) => (
  <AdminPage shell={shell} title={product ? `Edit: ${product.name}` : 'New product'} wide>
    <p>
      <a href="/admin/products">← All products</a>
      {product ? (
        <>
          {' '}
          · <a href={`/p/${product.slug}`} target="_blank" rel="noopener">View in store ↗</a>
        </>
      ) : null}
    </p>
    <form method="post" action={product ? `/admin/products/${product.id}` : '/admin/products'} enctype="multipart/form-data">
      <ProductFields values={values} errors={errors} categories={categories} settings={shell.settings} imageIds={product?.imageIds ?? []} />
      <div class="actions sticky-actions">
        <button type="submit" class="btn btn-primary">
          {product ? 'Save product' : 'Create product'}
        </button>
        <a href="/admin/products" class="btn">
          Cancel
        </a>
      </div>
    </form>
    {product ? (
      <div class="panel danger-zone">
        <h2>Delete</h2>
        <p class="muted small">Removes the product and its photos. Past orders keep their copy of the details.</p>
        <DeleteForm action={`/admin/products/${product.id}/delete`} label="Delete product" confirm={`Delete "${product.name}"? This cannot be undone.`} />
      </div>
    ) : null}
  </AdminPage>
);
