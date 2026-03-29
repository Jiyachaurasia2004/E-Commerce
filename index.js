// server.js
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 4000;

app.use(express.json());
app.use(cors());

// ------------------- Cloudinary Setup -------------------
const { v2: cloudinary } = require('cloudinary');
const CloudinaryStorage = require('multer-storage-cloudinary');

const storage = new CloudinaryStorage({
    cloudinary: cloudinary, // pass the v2 instance
    params: {
        folder: 'ecommerce_products',
        allowed_formats: ['jpg', 'jpeg', 'png'],
        public_id: (req, file) => `${file.fieldname}_${Date.now()}`,
    },
});

const upload = multer({ storage });

// ------------------- MongoDB Connection -------------------
const onlineURI = process.env.ONLINE_MONGO_URI;
const localURI = process.env.LOCAL_MONGO_URI || "mongodb://0.0.0.0:27017/e-commerce";

mongoose.connect(onlineURI)
.then(() => console.log("Connected to online MongoDB"))
.catch((onlineError) => {
    console.log("Online MongoDB failed:", onlineError.message);
    console.log("Trying local MongoDB...");
    mongoose.connect(localURI)
    .then(() => console.log("Connected to local MongoDB"))
    .catch((localError) => {
        console.log("Local MongoDB failed. Exiting...");
        process.exit(1);
    });
});

// ------------------- Basic Route -------------------
app.get("/", (req, res) => res.send("Express App is Running"));

// ------------------- Product Schema -------------------
const Product = mongoose.model("Product", {
    id: { type: Number, required: true },
    name: { type: String, required: true },
    image: { type: String, required: true },
    category: { type: String, required: true },
    new_price: { type: Number, required: true },
    old_price: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    available: { type: Boolean, default: true },
});

// ------------------- Upload Endpoint -------------------
app.post("/upload", upload.single('product'), (req, res) => {
    if (!req.file || !req.file.path) {
        return res.status(400).json({ success: 0, message: "Image upload failed" });
    }
    res.json({ success: 1, image_url: req.file.path });
});

// ------------------- Add Product -------------------
app.post('/addproduct', async (req, res) => {
    let products = await Product.find({});
    let id = products.length > 0 ? products.slice(-1)[0].id + 1 : 1;

    // Convert prices to numbers
    const newPrice = parseFloat(req.body.new_price);
    const oldPrice = parseFloat(req.body.old_price);

    if (isNaN(newPrice) || isNaN(oldPrice)) {
        return res.status(400).json({ success: false, message: "Prices must be valid numbers" });
    }

    const product = new Product({
        id: id,
        name: req.body.name,
        image: req.body.image_url, // from Cloudinary
        category: req.body.category,
        new_price: newPrice,
        old_price: oldPrice,
    });

    await product.save();
    res.json({ success: true, name: req.body.name });
});
// ------------------- Remove Product -------------------
app.post('/removeproduct', async (req, res) => {
    await Product.findOneAndDelete({ id: req.body.id });
    res.json({ success: true, name: req.body.name });
});

// ------------------- Get All Products -------------------
app.get('/allproducts', async (req, res) => {
    let products = await Product.find({});
    res.send(products);
});

// ------------------- User Schema -------------------
const Users = mongoose.model('Users', {
    name: { type: String },
    email: { type: String, unique: true },
    password: { type: String },
    cartData: { type: Object },
    date: { type: Date, default: Date.now }
});

// ------------------- Signup -------------------
app.post('/signup', async (req, res) => {
    let check = await Users.findOne({ email: req.body.email });
    if (check) return res.status(400).json({ success: false, errors: "User already exists" });

    let cart = {};
    for (let i = 0; i < 300; i++) cart[i] = 0;

    const user = new Users({
        name: req.body.username,
        email: req.body.email,
        password: req.body.password,
        cartData: cart
    });

    await user.save();

    const token = jwt.sign({ user: { id: user._id } }, 'secret_ecom');
    res.json({ success: true, token });
});

// ------------------- Login -------------------
app.post('/login', async (req, res) => {
    let user = await Users.findOne({ email: req.body.email });
    if (!user) return res.json({ success: false, errors: "Wrong Email Id" });

    if (req.body.password === user.password) {
        const token = jwt.sign({ user: { id: user._id } }, 'secret_ecom');
        res.json({ success: true, token });
    } else {
        res.json({ success: false, errors: "Wrong password" });
    }
});

// ------------------- Auth Middleware -------------------
const fetchUser = async (req, res, next) => {
    const token = req.header('auth-token');
    if (!token) return res.status(401).send({ errors: "Please authenticate with valid token" });

    try {
        const data = jwt.verify(token, 'secret_ecom');
        req.user = data.user;
        next();
    } catch {
        res.status(401).send({ errors: "Please authenticate with valid token" });
    }
};

// ------------------- Cart Endpoints -------------------
app.post('/addtocart', fetchUser, async (req, res) => {
    let userData = await Users.findOne({ _id: req.user.id });
    userData.cartData[req.body.itemId] += 1;
    await Users.findOneAndUpdate({ _id: req.user.id }, { cartData: userData.cartData });
    res.send('Added');
});

app.post('/removefromcart', fetchUser, async (req, res) => {
    let userData = await Users.findOne({ _id: req.user.id });
    if (userData.cartData[req.body.itemId] > 0) userData.cartData[req.body.itemId] -= 1;
    await Users.findOneAndUpdate({ _id: req.user.id }, { cartData: userData.cartData });
    res.send('Removed');
});

app.post('/getcart', fetchUser, async (req, res) => {
    let userData = await Users.findOne({ _id: req.user.id });
    if (!userData) return res.status(404).json({ error: "User not found" });
    res.json(userData.cartData);
});

// ------------------- Collections -------------------
app.get('/newcollections', async (req, res) => {
    let products = await Product.find({});
    let newcollection = products.slice(1).slice(-8);
    res.send(newcollection);
});

app.get('/popularinwomen', async (req, res) => {
    let products = await Product.find({ category: "women" });
    res.send(products.slice(0, 4));
});

// ------------------- Start Server -------------------
app.listen(port, () => console.log("Server Running on port " + port));