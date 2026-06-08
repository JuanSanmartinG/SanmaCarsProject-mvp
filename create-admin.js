import pg from "pg";
import bcrypt from "bcrypt";

const db = new pg.Pool({
  user: "postgres",
  host: "localhost",
  database: "sanmacars",
  password: "232408",
  port: 5432,
});

db.connect();

async function createAdminUser() {
    
const email = "example@sanmacars.com";
const passwordPlana = "PON_AQUI_TU_CONTRASEÑA_TEMPORAL";

    const saltRounds = 10;

    try {
        console.log("Conectando a PostgreSQL...");
        await db.connect();
        console.log("Encriptando contraseña con bcrypt...");
        const hash = await bcrypt.hash(plainPassword, saltRounds);
        console.log(`> Hash generado con éxito: ${hash.substring(0, 20)}...`);
        console.log("Insertando administrador en la tabla 'users'...");
        await db.query(
            "INSERT INTO users (email, password_hash) VALUES ($1, $2)",
            [adminEmail, hash]
        );
        console.log(`¡ÉXITO! El usuario [${adminEmail}] ya es Admin.`);

    } catch (error) {
        console.error(" Error al crear el usuario administrador:", error.stack);
    } finally {
        await db.end();
    }
}

createAdminUser();