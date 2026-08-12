import express from "express";
import bodyParser from "body-parser";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from "pg"; 
import dotenv from 'dotenv';
import {v2 as cloudinary} from 'cloudinary';
import multer from "multer";
import bcrypt from "bcrypt";
import session from "express-session";

dotenv.config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = multer.memoryStorage();
const upload = multer({storage:storage });

const db = new pg.Pool(
    process.env.DATABASE_URL
        ? { 
            connectionString: process.env.DATABASE_URL, 
            ssl: { rejectUnauthorized: false } 
          }
        : {
            user: process.env.DB_USER,
            host: process.env.DB_HOST,
            database: process.env.DB_DATABASE,
            password: process.env.DB_PASSWORD,
            port: process.env.DB_PORT,
          }
);

db.connect();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3000;

app.use(express.static("public"));
app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false, 
    cookie: {maxAge: 1000 * 60 *60 *2}
}));

app.use((req,res,next) => {
    res.locals.user = req.session.user || null;
    next();
});

function isAuthorizated(req, res, next){
    if (req.session.user){
        return next();
    }
    console.log("Intento de acceso no autorizado. Rebotando a /login");
    res.redirect("/login");
}

// Public Routes

app.get("/", async (req, res) => {
    const searchTerm = req.query.search; 
    try {
        let result; 
        
        const baseQuery = `
            SELECT c.*, 
                   COALESCE(json_agg(ci.image_url) FILTER (WHERE ci.image_url IS NOT NULL), '[]') as images
            FROM cars c
            LEFT JOIN car_images ci ON c.id = ci.car_id
        `;

        if (searchTerm) {
            const queryText = `
                ${baseQuery}
                WHERE c.make ILIKE $1 
                   OR c.model ILIKE $1 
                   OR c.plate_ending ILIKE $1 
                   OR c.description ILIKE $1 
                   OR c.year::TEXT ILIKE $1 
                GROUP BY c.id
                ORDER BY c.id ASC`;
            result = await db.query(queryText, [`%${searchTerm}%`]);
        } else {
            const queryText = `
                ${baseQuery}
                GROUP BY c.id 
                ORDER BY c.id ASC`;
            result = await db.query(queryText);
        }
        
        res.render("index.ejs",{
            posts: result.rows, 
            year: new Date().getFullYear(),
            searchTerm: searchTerm || ""
        });
    } catch (error) {
        console.error("Error executing query", error.stack);
        res.status(500).send("Something went wrong with the database");
    }
});

app.get("/login", (req,res) => {
res.render("login.ejs", {year: new Date().getFullYear(), error:null});
});

app.post("/login", async (req,res) => {
    const {email, password} = req.body;

        try {
            const result = await db.query("SELECT * FROM users WHERE email = $1", [email])
                if (result.rows.length > 0){
                        const user = result.rows[0]

        const match = await bcrypt.compare(password, user.password_hash);

        if (match){
            req.session.user = { id: user.id, email: user.email };
            console.log(` Sesión iniciada con éxito para: ${user.email}`);
            return res.redirect("/");
    }
    }

res.render("login.ejs", {
    year: new Date().getFullYear(),
    error: "Credenciales incorrectas. Inténtalo de nuevo."
    });

    } catch (error) {

console.error("Error en el proceso de login:", error);
res.status(500).send("Error en el servidor");
}
}); 

app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        console.log("Sesión cerrada.");
        res.redirect("/");
    });
});

app.get("/new-post", isAuthorizated, (req, res) => {
    res.render("new-post.ejs", { year: new Date().getFullYear() });
});
app.post("/add-car", isAuthorizated, upload.array("images", 5), async (req, res) => {
    console.log("Form Data Received:", req.body);
    const {make, model, year, price, plate, description} = req.body;
        
        let finalImageUrls = ["https://images.unsplash.com/photo-1542282088-fe8426682b8f"]; 
    
    if (req.files && req.files.length > 0) {
        try {
            const uploadPromises = req.files.map(file => {
                return new Promise((resolve, reject) => {
                    const uploadStream = cloudinary.uploader.upload_stream(
                        {folder: "sanmacars_inventory"},
                        (error, result) => {
                            if (error) return reject(error);
                            resolve(result.secure_url);
                        }
                    );
                    uploadStream.end(file.buffer);
                });
            });
            finalImageUrls = await Promise.all(uploadPromises); 
        } catch (uploadError) {
            console.error("Cloudinary Upload Failure:", uploadError);
        }
    }
    
    try {
        const carResult = await db.query(
            "INSERT INTO cars (make, model, year, price, plate_ending, description) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id", 
            [make, model, parseInt(year), parseFloat(price), plate, description]
        );
        
        const newCarId = carResult.rows[0].id;

        for (let url of finalImageUrls) {
            await db.query(
                "INSERT INTO car_images (car_id, image_url) VALUES ($1, $2)",
                [newCarId, url]
            );
        }

        res.redirect("/");
    } catch(err) {
        console.error("Error adding car:", err.stack);
        res.status(500).send("Could not add car to database");
    }
});

app.get("/edit/:id", isAuthorizated, async (req, res) => {
    const carId = parseInt(req.params.id);
    try {
        const carResult = await db.query("SELECT * FROM cars WHERE id = $1", [carId]);
        
        if (carResult.rows.length === 0) {
            return res.status(404).send("Vehículo no encontrado");
        }

        const imagesResult = await db.query("SELECT image_url FROM car_images WHERE car_id = $1", [carId]);
        
        const post = carResult.rows[0];
        post.images = imagesResult.rows.map(row => row.image_url);

        res.render('edit-post.ejs', { post, year: new Date().getFullYear() });
    } catch (error) {
        console.error("Error fetching car for edit:", error.stack);
        res.status(500).send("Error al cargar los datos del vehículo");
    }
});

// Changed from single("image") to array("images", 5)
app.post("/edit/:id", isAuthorizated, upload.array("images", 5), async (req, res) => {
    const carId = parseInt(req.params.id);
    const { make, model, year, price, plate, description } = req.body;

    try {
        // 1. Update text details in 'cars' table
        await db.query(
            "UPDATE cars SET make=$1, model=$2, year=$3, price=$4, plate_ending=$5, description=$6 WHERE id=$7", 
            [make, model, parseInt(year), parseFloat(price), plate, description, carId]
        );

        if (req.files && req.files.length > 0) {
            const oldImages = await db.query("SELECT image_url FROM car_images WHERE car_id = $1", [carId]);
            for (const record of oldImages.rows) {
                if (record.image_url.includes("cloudinary.com")) {
                    const urlParts = record.image_url.split('/');
                    const fileWithExtension = urlParts[urlParts.length - 1];
                    const publicWithoutExtension = fileWithExtension.split('.')[0];
                    await cloudinary.uploader.destroy(`sanmacars_inventory/${publicWithoutExtension}`);
                }
            }

            await db.query("DELETE FROM car_images WHERE car_id = $1", [carId]);

            const uploadPromises = req.files.map(file => {
                return new Promise((resolve, reject) => {
                    const uploadStream = cloudinary.uploader.upload_stream(
                        { folder: "sanmacars_inventory" },
                        (error, result) => {
                            if (error) return reject(error);
                            resolve(result.secure_url);
                        }
                    );
                    uploadStream.end(file.buffer);
                });
            });
            const newUrls = await Promise.all(uploadPromises);

            for (let url of newUrls) {
                await db.query(
                    "INSERT INTO car_images (car_id, image_url) VALUES ($1, $2)",
                    [carId, url]
                );
            }
        }

        res.redirect("/");
    } catch (error) {
        console.error("Error updating car:", error.stack);
        res.status(500).send("No se pudo actualizar el vehículo en la base de datos");
    }
});

app.post("/delete/:id", isAuthorizated, async (req, res) => {
    const carId = parseInt(req.params.id);
    console.log(`\n--- INICIANDO PROCESO DE ELIMINACIÓN PARA EL ID: ${carId} ---`);

    try {
        const carImages = await db.query("SELECT image_url FROM car_images WHERE car_id = $1", [carId]);
        
        for (const record of carImages.rows) {
            const url = record.image_url;
            if (url && url.includes("cloudinary.com")) {
                const urlParts = url.split('/');
                const fileWithExtension = urlParts[urlParts.length - 1];
                const publicWithoutExtension = fileWithExtension.split('.')[0];
                const fullCloudinaryPublicId = `sanmacars_inventory/${publicWithoutExtension}`;

                console.log(`> Eliminando de Cloudinary: "${fullCloudinaryPublicId}"`);
                await cloudinary.uploader.destroy(fullCloudinaryPublicId);
            }
        }

        await db.query("DELETE FROM car_images WHERE car_id = $1", [carId]);
        
        await db.query("DELETE FROM cars WHERE id = $1", [carId]);
        
        console.log("> Registro y sus imágenes eliminados exitosamente");
        res.redirect("/");

    } catch (error) {
        console.error("Error crítico en el proceso de eliminación:", error.stack);
        res.status(500).send("Ocurrió un error en el servidor al intentar eliminar el vehículo.");
    }
});

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));