import express from "express";
import bodyParser from "body-parser";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3000;

// Temporary Data Storage
let posts = [
  {
      id: 1,
      make: "Kia",
      model: "Río Xcite",
      year: 2008,
      description: "Vehiculo familiar en excelente estado. Poco kilometraje para el año, full equipo.",
      price: 25000000,
      imageUrl: "/images/Rio2008/Kia Rio 1.jpeg",
      plate: "2",
      location: "Toberin, Bogotá"
  }
];

app.use(express.static("public"));
app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.get("/", (req, res) => {
    res.render("index.ejs", { posts: posts, year: new Date().getFullYear() }); 
});

app.get("/new-post", (req, res) => {
    res.render("new-post.ejs", { year: new Date().getFullYear() });
});

app.post("/add-car", (req, res) =>{
    const newId = posts.length > 0 ? Math.max(...posts.map(p => p.id)) + 1 : 1;
    const newCar = {
        id: newId,
        ...req.body,
        year: parseInt(req.body.year), 
        price: parseInt(req.body.price)
    };
    posts.push(newCar);
    res.redirect('/');
});

app.get('/edit/:id', (req, res) => {
    const post = posts.find(p => p.id === parseInt(req.params.id));
    res.render('edit-post.ejs', { post: post, year: new Date().getFullYear() });
});

app.post('/edit/:id', (req, res) => {
    const index = posts.findIndex(p => p.id === parseInt(req.params.id));
    if (index !== -1) {
        posts[index] = { id: parseInt(req.params.id), ...req.body };
        res.redirect('/');
    }
});

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));