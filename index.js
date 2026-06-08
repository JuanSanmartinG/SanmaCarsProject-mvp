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

const db = new pg.Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

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
    console.log(" Intento de acceso no autorizado. Rebotando a /login");
    res.redirect("/login");
}

// Public Routes

app.get("/", async (req, res) => {
    const searchTerm = req.query.search; 
    try {
        let result; 
        if (searchTerm) {
            const queryText = `
                SELECT * FROM cars 
                WHERE make ILIKE $1 
                   OR model ILIKE $1 
                   OR plate_ending ILIKE $1 
                   OR description ILIKE $1 
                   OR year::TEXT ILIKE $1 
                ORDER BY id ASC`;

                result = await db.query (queryText, [`%${searchTerm}%`])
        }else{
            result = await db.query ("SELECT * FROM cars ORDER BY id ASC")
        }
        const allCars = result.rows;

        res.render("index.ejs",{
            posts: allCars, 
            year: new Date().getFullYear(),
            searchTerm: searchTerm || ""
        })
    } catch (error) {
        console.error("Error executing query", error.stack);
        res.status(500).send("Something went wrong with the database")
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
        console.log(" Sesión cerrada.");
        res.redirect("/");
    })
})

app.get("/new-post", isAuthorizated, (req, res) => {
    res.render("new-post.ejs", { year: new Date().getFullYear() });
});

app.post("/add-car",isAuthorizated,  upload.single("image"), async (req, res) => {
    console.log("Form Data Received:", req.body);
    const {make, model, year, price, plate, description} = req.body;
    let finalImageUrl = "https://images.unsplash.com/photo-1542282088-fe8426682b8f"
    if (req.file) {
        try {
            const cloudinaryResult = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    {folder: "sanmacars_inventory"},
                    (error, result) => {
                        if (error) return reject(error);
                        resolve(result);
                    }
                );
                uploadStream.end(req.file.buffer);
            });
            finalImageUrl = cloudinaryResult.secure_url; 
        } catch (uploadError) {
            console.error("Couldinary Upload Failure, using default fallback image:", uploadError)
        }
    }
    try {
        await db.query(
            "INSERT INTO cars (make, model, year, price, plate_ending, description, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7)", 
            [make, model, parseInt(year), parseFloat(price), plate, description, finalImageUrl]
            );
            res.redirect("/");
        } catch(err) {
            console.error("Error adding car:", err.stack);
            res.status(500).send("Could not add car to database");
        }
    });

app.get ("/edit/:id",isAuthorizated, async (req, res) =>{
    const carId = parseInt(req.params.id);
    try {
        const result = await db.query("SELECT * FROM cars WHERE id = $1", [carId]);
        if (result.rows.length > 0 ) {
            res.render('edit-post.ejs', {post: result.rows[0], year: new Date().getFullYear() });
        }else{
            res.status(404).send("Vehiculo no encontrado")
        }
    } catch (error) {
        console.error("Error fetching car for edit:", error.stack);
        res.status(500).send("Error al cargar los datos del vehiculo")
    }
})

app.post("/edit/:id",isAuthorizated, upload.single("image"), async (req, res)=>{
    const carId = parseInt(req.params.id);
    const {make, model, year, price, plate, description} = req.body;

    try {

        const currentRecord = await db.query ("SELECT image_url FROM cars WHERE id = $1", [carId]);
        if (currentRecord.rows.length === 0) {
            return res.status(404).send("Vechículo no encontrado");
        }

        let finalImageUrl = currentRecord.rows[0].image_url;

        if (req.file){
            const cloudinaryResult = await new Promise ((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream (
                    {folder: "sanmacars_inventory"},
                    (error, result) => {
                        if (error) return reject(error);
                        resolve(result)
                    }
                );
                uploadStream.end(req.file.buffer);
            });
            finalImageUrl = cloudinaryResult.secure_url;
        }

        await db.query (
            "UPDATE cars SET make=$1, model=$2, year=$3, price=$4, plate_ending=$5, description=$6, image_url=$7 WHERE id=$8", 
            [make, model, parseInt(year), parseFloat(price), plate, description, finalImageUrl, carId ]
        );
        res.redirect("/")
        
    } catch (error) {
        console.error("Error updating car:", error.stack);
        res.status(500).send("No se pudo actualizar el vehículo en la base de datos")
        
    }
});

app.post("/delete/:id",isAuthorizated, async (req, res) => {
    const carId = parseInt(req.params.id)
    console.log(`\n--- INICIANDO PROCESO DE ELIMINACIÓN PARA EL ID: ${carId} ---`)

    try {
        const carRecord = await db.query("SELECT image_url FROM cars WHERE id = $1", [carId]);
        if (carRecord.rows.length > 0 ){
            const imageUrl = carRecord.rows[0].image_url;
            console.log(`> URL de la imagen encontrada en la BD: "${imageUrl}`);
            
            if (imageUrl && imageUrl.includes("cloudinary.com")){
                console.log("> Enlace de cloudinary encontrado, iniciando extracción del public ID");

                const urlParts = imageUrl.split('/');
                const fileWithExtension = urlParts[urlParts.length -1];
                const publicWithoutExtension = fileWithExtension.split('.')[0];
                const fullCloudinaryPublicId = `sanmacars_inventory/${publicWithoutExtension}`;

                console.log(`> Identificador único final para cloudinary: "${fullCloudinaryPublicId}`)

                const cloudDeleteResult = await cloudinary.uploader.destroy(fullCloudinaryPublicId);
                console.log("Respuesta del servidor de cloudinary:", cloudDeleteResult);
            } else{
                console.log("Eliminación en la nube omitida: El vehiculo no usa una imagen de cloudinary.")
            }
            }else{
                console.log("No se encontró ningún regristro con ese ID en la base de datos")
            }
            await db.query("DELETE FROM cars WHERE id = $1", [carId]);
            console.log("Registro de eliminación completado con éxito")
            console.log("> Registro eliminado exitosamente de la base de datos")

            res.redirect("/");
        } catch (error) {
            console.error("error crítico en el pipeline de información:", error.stack);
            res.status(500).send("Ocurrio un error en el servidor al intentar eliminar el vehículo.")
    }
})

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));