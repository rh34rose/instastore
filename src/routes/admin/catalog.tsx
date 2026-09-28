import { Hono } from 'hono';
import type { AppEnv } from '../../app';
import { checkbox, files, integer, text } from '../../forms';
import { parseMoney } from '../../money';
import { slugify } from '../../slug';
import type { CategoryInput, ProductInput } from '../../types';
import {
  CategoriesPage,
  CategoryEditPage,
  ProductFormPage,
  ProductsPage,
  categoryToForm,
  emptyCategoryValues,
  emptyProductValues,
  productToForm,
  type CategoryErrors,
  type CategoryFormValues,
  type ProductErrors,
  type ProductFormValues,
} from '../../views/admin/catalog';
import { NotFoundPage } from '../../views/errors';
import { loadAdminShell, redirectWithFlash, storeUploads } from './shared';

const catalog = new Hono<AppEnv>();

// ───────────────────────── Categories ─────────────────────────

function readCategoryForm(form: FormData): CategoryFormValues {
  return {
    name: text(form, 'name', 80),
    slug: text(form, 'slug', 60),
    description: text(form, 'description', 1000),
    sortOrder: text(form, 'sortOrder', 10),
  };
}

function validateCategory(v: CategoryFormValues): { input: CategoryInput; errors: CategoryErrors } {
  const errors: CategoryErrors = {};
  if (!v.name) errors.name = 'Name is required.';
  if (v.slug && slugify(v.slug) !== v.slug) errors.slug = 'Use lowercase letters, numbers and hyphens only.';
  const sortOrder = Number(v.sortOrder || '0');
  return {
    input: { name: v.name, slug: v.slug, description: v.description, sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0 },
    errors,
  };
}

async function productCounts(c: Parameters<typeof loadAdminShell>[0]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const p of await c.get('store').listProducts()) {
    if (p.categoryId) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
  }
  return counts;
}

catalog.get('/admin/categories', async (c) => {
  const [shell, categories, counts] = await Promise.all([loadAdminShell(c), c.get('store').listCategories(), productCounts(c)]);
  return c.html(<CategoriesPage shell={shell} categories={categories} counts={counts} values={emptyCategoryValues} errors={{}} />);
});

catalog.post('/admin/categories', async (c) => {
  const form = await c.req.formData();
  const values = readCategoryForm(form);
  const { input, errors } = validateCategory(values);
  const store = c.get('store');
  if (Object.keys(errors).length === 0) {
    const upload = await storeUploads(store, files(form, 'image'));
    if (!upload.ok) errors.image = upload.error;
    else {
      await store.createCategory({ ...input, imageId: upload.ids[0] ?? null });
      return redirectWithFlash(c, '/admin/categories', 'created');
    }
  }
  const [shell, categories, counts] = await Promise.all([loadAdminShell(c), store.listCategories(), productCounts(c)]);
  return c.html(<CategoriesPage shell={shell} categories={categories} counts={counts} values={values} errors={errors} />, 400);
});

catalog.get('/admin/categories/:id', async (c) => {
  const [shell, category, counts] = await Promise.all([loadAdminShell(c), c.get('store').getCategory(c.req.param('id')), productCounts(c)]);
  if (!category) return c.html(<NotFoundPage home="/admin/categories" />, 404);
  return c.html(<CategoryEditPage shell={shell} category={category} values={categoryToForm(category)} errors={{}} productCount={counts.get(category.id) ?? 0} />);
});

catalog.post('/admin/categories/:id', async (c) => {
  const store = c.get('store');
  const category = await store.getCategory(c.req.param('id'));
  if (!category) return redirectWithFlash(c, '/admin/categories', 'not-found');
  const form = await c.req.formData();
  const values = readCategoryForm(form);
  const { input, errors } = validateCategory(values);

  let imageId = category.imageId;
  if (Object.keys(errors).length === 0) {
    const upload = await storeUploads(store, files(form, 'image'));
    if (!upload.ok) errors.image = upload.error;
    else if (upload.ids[0]) {
      if (imageId) await store.deleteImage(imageId);
      imageId = upload.ids[0];
    } else if (checkbox(form, 'removeImage') && imageId) {
      await store.deleteImage(imageId);
      imageId = null;
    }
  }
  if (Object.keys(errors).length > 0) {
    const [shell, counts] = await Promise.all([loadAdminShell(c), productCounts(c)]);
    return c.html(<CategoryEditPage shell={shell} category={category} values={values} errors={errors} productCount={counts.get(category.id) ?? 0} />, 400);
  }
  await store.updateCategory(category.id, { ...input, imageId });
  return redirectWithFlash(c, `/admin/categories/${category.id}`, 'saved');
});

catalog.post('/admin/categories/:id/delete', async (c) => {
  await c.get('store').deleteCategory(c.req.param('id'));
  return redirectWithFlash(c, '/admin/categories', 'deleted');
});

// ───────────────────────── Products ─────────────────────────

function readProductForm(form: FormData): ProductFormValues {
  return {
    name: text(form, 'name', 120),
    slug: text(form, 'slug', 60),
    categoryId: text(form, 'categoryId', 40),
    price: text(form, 'price', 20),
    compareAtPrice: text(form, 'compareAtPrice', 20),
    description: text(form, 'description', 5000),
    inStock: checkbox(form, 'inStock'),
    featured: checkbox(form, 'featured'),
    active: checkbox(form, 'active'),
    sortOrder: text(form, 'sortOrder', 10),
  };
}

function validateProduct(v: ProductFormValues, currency: string): { input: ProductInput; errors: ProductErrors } {
  const errors: ProductErrors = {};
  if (!v.name) errors.name = 'Name is required.';
  if (v.slug && slugify(v.slug) !== v.slug) errors.slug = 'Use lowercase letters, numbers and hyphens only.';
  const price = parseMoney(v.price, currency);
  if (price === null) errors.price = 'Enter a price, e.g. 249 or 249.50.';
  const compareAt = v.compareAtPrice === '' ? null : parseMoney(v.compareAtPrice, currency);
  if (v.compareAtPrice !== '' && compareAt === null) errors.compareAtPrice = 'Enter an amount or leave empty.';
  const sortOrder = Number(v.sortOrder || '0');
  return {
    input: {
      name: v.name,
      slug: v.slug,
      description: v.description,
      price: price ?? 0,
      compareAtPrice: compareAt,
      categoryId: v.categoryId || null,
      inStock: v.inStock,
      featured: v.featured,
      active: v.active,
      sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
    },
    errors,
  };
}

catalog.get('/admin/products', async (c) => {
  const categoryId = (c.req.query('category') ?? '').slice(0, 40);
  const query = (c.req.query('q') ?? '').trim().slice(0, 100);
  const filter = { query, ...(categoryId === 'none' ? { categoryId: null } : categoryId ? { categoryId } : {}) };
  const [shell, categories, products] = await Promise.all([loadAdminShell(c), c.get('store').listCategories(), c.get('store').listProducts(filter)]);
  return c.html(<ProductsPage shell={shell} products={products} categories={categories} categoryId={categoryId} query={query} />);
});

catalog.get('/admin/products/new', async (c) => {
  const [shell, categories] = await Promise.all([loadAdminShell(c), c.get('store').listCategories()]);
  return c.html(<ProductFormPage shell={shell} product={null} values={emptyProductValues} errors={{}} categories={categories} />);
});

catalog.post('/admin/products', async (c) => {
  const store = c.get('store');
  const form = await c.req.formData();
  const values = readProductForm(form);
  const shell = await loadAdminShell(c);
  const { input, errors } = validateProduct(values, shell.settings.currency);
  if (Object.keys(errors).length === 0) {
    const upload = await storeUploads(store, files(form, 'images'));
    if (!upload.ok) errors.images = upload.error;
    else {
      const product = await store.createProduct({ ...input, imageIds: upload.ids });
      return redirectWithFlash(c, `/admin/products/${product.id}`, 'created');
    }
  }
  const categories = await store.listCategories();
  return c.html(<ProductFormPage shell={shell} product={null} values={values} errors={errors} categories={categories} />, 400);
});

catalog.get('/admin/products/:id', async (c) => {
  const [shell, categories, product] = await Promise.all([loadAdminShell(c), c.get('store').listCategories(), c.get('store').getProduct(c.req.param('id'))]);
  if (!product) return c.html(<NotFoundPage home="/admin/products" />, 404);
  return c.html(<ProductFormPage shell={shell} product={product} values={productToForm(product, shell.settings.currency)} errors={{}} categories={categories} />);
});

catalog.post('/admin/products/:id', async (c) => {
  const store = c.get('store');
  const product = await store.getProduct(c.req.param('id'));
  if (!product) return redirectWithFlash(c, '/admin/products', 'not-found');
  const form = await c.req.formData();
  const values = readProductForm(form);
  const shell = await loadAdminShell(c);
  const { input, errors } = validateProduct(values, shell.settings.currency);

  if (Object.keys(errors).length === 0) {
    const upload = await storeUploads(store, files(form, 'images'));
    if (!upload.ok) errors.images = upload.error;
    else {
      // Existing photos: drop the removed ones, move the chosen main photo first, then append uploads.
      const removed = new Set(form.getAll('removeImage').filter((v): v is string => typeof v === 'string'));
      const primary = text(form, 'primaryImage', 40);
      const kept = product.imageIds.filter((id) => !removed.has(id));
      const ordered = kept.includes(primary) ? [primary, ...kept.filter((id) => id !== primary)] : kept;
      await store.updateProduct(product.id, { ...input, imageIds: [...ordered, ...upload.ids] });
      for (const id of product.imageIds) if (removed.has(id)) await store.deleteImage(id);
      return redirectWithFlash(c, `/admin/products/${product.id}`, 'saved');
    }
  }
  const categories = await store.listCategories();
  return c.html(<ProductFormPage shell={shell} product={product} values={values} errors={errors} categories={categories} />, 400);
});

catalog.post('/admin/products/:id/delete', async (c) => {
  await c.get('store').deleteProduct(c.req.param('id'));
  return redirectWithFlash(c, '/admin/products', 'deleted');
});

export default catalog;
