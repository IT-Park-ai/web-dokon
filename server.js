require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dokon';
const TZ = process.env.TZ_NAME || 'Asia/Tashkent';

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, trim: true, maxlength: 60, default: '' },
    quantity: { type: Number, required: true, min: 0, default: 0 },
    costPrice: { type: Number, required: true, min: 0 },
    sellPrice: { type: Number, required: true, min: 0 },
    minStock: { type: Number, min: 0, default: 5 },
  },
  { timestamps: true }
);
const Product = mongoose.model('Product', productSchema);

const saleSchema = new mongoose.Schema(
  {
    receipt: { type: mongoose.Schema.Types.ObjectId, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    productName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    costPrice: { type: Number, required: true, min: 0 },
    sellPrice: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);
saleSchema.index({ createdAt: -1 });
const Sale = mongoose.model('Sale', saleSchema);

const app = express();
app.use(express.json());

const page = (file) => (req, res) => res.sendFile(path.join(__dirname, 'public', file));
app.get('/sale', page('sale.html'));
app.get('/input', page('input.html'));

app.use(express.static(path.join(__dirname, 'public')));

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === undefined || v === null || v === '' ? NaN : Number(v));

const checkId = (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "ID noto'g'ri" });
  next();
};

function readProduct(body) {
  const name = String(body.name || '').trim();
  const category = String(body.category || '').trim();
  const quantity = num(body.quantity);
  const costPrice = num(body.costPrice);
  const sellPrice = num(body.sellPrice);
  const minStock = body.minStock === undefined || body.minStock === '' ? 5 : Number(body.minStock);
  if (!name) return { error: 'Mahsulot nomini kiriting' };
  if (!Number.isFinite(quantity) || quantity < 0) return { error: "Soni 0 yoki undan katta bo'lishi kerak" };
  if (!Number.isFinite(costPrice) || costPrice < 0) return { error: "Kelgan narxi noto'g'ri" };
  if (!Number.isFinite(sellPrice) || sellPrice < 0) return { error: "Sotish narxi noto'g'ri" };
  if (!Number.isFinite(minStock) || minStock < 0) return { error: "Minimal qoldiq noto'g'ri" };
  return { data: { name, category, quantity, costPrice, sellPrice, minStock } };
}

app.get('/api/health', (req, res) => {
  const ok = mongoose.connection.readyState === 1;
  res.status(ok ? 200 : 503).json({ ok, db: mongoose.connection.name });
});

app.get('/api/products', h(async (req, res) => {
  const filter = {};
  const q = String(req.query.q || '').trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { category: rx }];
  }
  res.json(await Product.find(filter).sort({ createdAt: -1 }));
}));

app.post('/api/products', h(async (req, res) => {
  const { data, error } = readProduct(req.body);
  if (error) return res.status(400).json({ error });
  res.status(201).json(await Product.create(data));
}));

app.put('/api/products/:id', checkId, h(async (req, res) => {
  const { data, error } = readProduct(req.body);
  if (error) return res.status(400).json({ error });
  const product = await Product.findByIdAndUpdate(req.params.id, data, { new: true });
  if (!product) return res.status(404).json({ error: 'Mahsulot topilmadi' });
  res.json(product);
}));

app.delete('/api/products/:id', checkId, h(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) return res.status(404).json({ error: 'Mahsulot topilmadi' });
  res.json({ ok: true });
}));

app.post('/api/products/:id/sell', checkId, h(async (req, res) => {
  const qty = num(req.body.quantity ?? 1);
  if (!(qty > 0)) return res.status(400).json({ error: "Soni noto'g'ri" });
  const customPrice = num(req.body.price);
  if (!Number.isNaN(customPrice) && customPrice < 0) return res.status(400).json({ error: "Narx noto'g'ri" });

  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, quantity: { $gte: qty } },
    { $inc: { quantity: -qty } },
    { new: true }
  );
  if (!product) return res.status(400).json({ error: "Omborda yetarli mahsulot yo'q" });

  const sale = await Sale.create({
    product: product._id,
    productName: product.name,
    quantity: qty,
    costPrice: product.costPrice,
    sellPrice: Number.isNaN(customPrice) ? product.sellPrice : customPrice,
  });
  res.status(201).json({ product, sale });
}));

app.post('/api/products/:id/restock', checkId, h(async (req, res) => {
  const qty = num(req.body.quantity);
  if (!(qty > 0)) return res.status(400).json({ error: "Soni noto'g'ri" });
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ error: 'Mahsulot topilmadi' });
  const batchCost = Number.isNaN(num(req.body.costPrice)) ? product.costPrice : num(req.body.costPrice);
  if (batchCost < 0) return res.status(400).json({ error: "Kelgan narxi noto'g'ri" });
  const total = product.quantity + qty;
  product.costPrice = round2((product.quantity * product.costPrice + qty * batchCost) / total);
  product.quantity = total;
  await product.save();
  res.json(product);
}));

app.post('/api/checkout', h(async (req, res) => {
  const raw = Array.isArray(req.body.items) ? req.body.items : [];
  if (!raw.length) return res.status(400).json({ error: "Savat bo'sh" });
  if (raw.length > 200) return res.status(400).json({ error: 'Savat juda katta' });

  // Bir xil tovar takrorlansa birlashtiramiz
  const merged = new Map();
  for (const it of raw) {
    if (!mongoose.isValidObjectId(it.productId)) return res.status(400).json({ error: "Mahsulot ID si noto'g'ri" });
    const quantity = num(it.quantity);
    if (!(quantity > 0)) return res.status(400).json({ error: "Soni noto'g'ri" });
    const price = num(it.price);
    if (!Number.isNaN(price) && price < 0) return res.status(400).json({ error: "Narx noto'g'ri" });
    const key = String(it.productId);
    const prev = merged.get(key);
    if (prev) prev.quantity += quantity;
    else merged.set(key, { productId: key, quantity, price });
  }

  const done = [];
  const rollback = () =>
    Promise.all(done.map((d) => Product.updateOne({ _id: d.product._id }, { $inc: { quantity: d.quantity } })));

  for (const it of merged.values()) {
    const product = await Product.findOneAndUpdate(
      { _id: it.productId, quantity: { $gte: it.quantity } },
      { $inc: { quantity: -it.quantity } },
      { new: true }
    );
    if (!product) {
      await rollback();
      const p = await Product.findById(it.productId).select('name quantity');
      return res.status(400).json({
        error: p ? `${p.name}: omborda faqat ${p.quantity} ta bor` : 'Mahsulot topilmadi',
      });
    }
    done.push({ product, quantity: it.quantity, price: it.price });
  }

  const receipt = new mongoose.Types.ObjectId();
  try {
    const lines = done.map((d) => ({
      receipt,
      product: d.product._id,
      productName: d.product.name,
      quantity: d.quantity,
      costPrice: d.product.costPrice,
      sellPrice: Number.isNaN(d.price) ? d.product.sellPrice : d.price,
    }));
    const sales = await Sale.insertMany(lines);
    const total = round2(lines.reduce((a, l) => a + l.quantity * l.sellPrice, 0));
    res.status(201).json({ receipt, total, sales });
  } catch (e) {
    await rollback();
    throw e;
  }
}));

app.delete('/api/receipts/:id', checkId, h(async (req, res) => {
  const lines = await Sale.find({ receipt: req.params.id });
  if (!lines.length) return res.status(404).json({ error: 'Chek topilmadi' });
  for (const l of lines) {
    const removed = await Sale.findOneAndDelete({ _id: l._id }); // ikki marta qaytarib yubormaslik uchun
    if (removed && removed.product) await Product.updateOne({ _id: removed.product }, { $inc: { quantity: removed.quantity } });
  }
  res.json({ ok: true });
}));

app.get('/api/sales', h(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 500, 2000);
  res.json(await Sale.find().sort({ createdAt: -1 }).limit(limit));
}));

app.delete('/api/sales/:id', checkId, h(async (req, res) => {
  const sale = await Sale.findByIdAndDelete(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sotuv topilmadi' });
  if (sale.product) await Product.updateOne({ _id: sale.product }, { $inc: { quantity: sale.quantity } });
  res.json({ ok: true });
}));

app.get('/api/stats', h(async (req, res) => {
  const dayKey = (d) => d.toLocaleDateString('sv-SE', { timeZone: TZ });
  const dayKeys = [];
  for (let i = 6; i >= 0; i--) dayKeys.push(dayKey(new Date(Date.now() - i * 864e5)));
  const since = new Date(Date.now() - 8 * 864e5);
  const weekAgo = new Date(Date.now() - 7 * 864e5);

  const [stockAgg, dailyAgg, top, low] = await Promise.all([
    Product.aggregate([
      {
        $group: {
          _id: null,
          kinds: { $sum: 1 },
          stockCost: { $sum: { $multiply: ['$quantity', '$costPrice'] } },
          stockValue: { $sum: { $multiply: ['$quantity', '$sellPrice'] } },
          lowCount: { $sum: { $cond: [{ $lte: ['$quantity', '$minStock'] }, 1, 0] } },
        },
      },
    ]),
    Sale.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } },
          revenue: { $sum: { $multiply: ['$quantity', '$sellPrice'] } },
          profit: { $sum: { $multiply: ['$quantity', { $subtract: ['$sellPrice', '$costPrice'] }] } },
          count: { $sum: 1 },
        },
      },
    ]),
    Sale.aggregate([
      { $match: { createdAt: { $gte: weekAgo } } },
      {
        $group: {
          _id: '$productName',
          quantity: { $sum: '$quantity' },
          revenue: { $sum: { $multiply: ['$quantity', '$sellPrice'] } },
        },
      },
      { $sort: { quantity: -1 } },
      { $limit: 5 },
    ]),
    Product.find({ $expr: { $lte: ['$quantity', '$minStock'] } }).sort({ quantity: 1 }).limit(8),
  ]);

  const byDay = Object.fromEntries(dailyAgg.map((d) => [d._id, d]));
  const days = dayKeys.map((date) => ({
    date,
    revenue: round2(byDay[date]?.revenue || 0),
    profit: round2(byDay[date]?.profit || 0),
    count: byDay[date]?.count || 0,
  }));
  const s = stockAgg[0] || { kinds: 0, stockCost: 0, stockValue: 0, lowCount: 0 };

  res.json({
    days,
    today: days[days.length - 1],
    stock: {
      kinds: s.kinds,
      stockCost: round2(s.stockCost),
      potentialProfit: round2(s.stockValue - s.stockCost),
      lowCount: s.lowCount,
    },
    top: top.map((t) => ({ name: t._id, quantity: t.quantity, revenue: round2(t.revenue) })),
    low,
  });
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Serverda xatolik' });
});

mongoose
  .connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
  .then(() => {
    console.log('MongoDB ulandi:', mongoose.connection.name);
    const server = app.listen(PORT, () => console.log(`\nSayt ishga tushdi -> http://localhost:${PORT}\n`));
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') console.error(`${PORT}-port band. .env faylda PORT=3001 deb yozing.`);
      else console.error(e);
      process.exit(1);
    });
  })
  .catch((e) => {
    console.error('\nMongoDB ga ulanib bo\'lmadi:', e.message);
    console.error('Tekshiring: 1) MongoDB ishlayaptimi  2) .env dagi MONGODB_URI to\'g\'rimi\n');
    process.exit(1);
  });