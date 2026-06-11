const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/tareas", async (req, res) => {
    const resultado = await pool.query(
        "SELECT * FROM tareas ORDER BY id DESC"
    );
    res.json(resultado.rows);
});

app.post("/tareas", async (req, res) => {
    const { titulo, prioridad, fechaLimite } = req.body;

    const resultado = await pool.query(
        `INSERT INTO tareas 
        (titulo, prioridad, estado, fecha_limite)
        VALUES ($1, $2, $3, $4)
        RETURNING *`,
        [titulo, prioridad || "media", "pendiente", fechaLimite || ""]
    );

    res.json(resultado.rows[0]);
});

app.put("/tareas/:id", async (req, res) => {
    const { id } = req.params;
    const { titulo, prioridad, estado, fechaLimite } = req.body;

    const resultado = await pool.query(
        `UPDATE tareas
        SET titulo = $1,
            prioridad = $2,
            estado = $3,
            fecha_limite = $4
        WHERE id = $5
        RETURNING *`,
        [titulo, prioridad, estado, fechaLimite || "", id]
    );

    res.json(resultado.rows[0]);
});

app.delete("/tareas/:id", async (req, res) => {
    const { id } = req.params;

    await pool.query(
        "DELETE FROM tareas WHERE id = $1",
        [id]
    );

    res.json({ mensaje: "Tarea eliminada" });
});

app.get("/cumplimiento", async (req, res) => {
    const resultado = await pool.query("SELECT * FROM tareas");
    const tareas = resultado.rows;

    const total = tareas.length;
    const completadas = tareas.filter(t => t.estado === "completada").length;
    const enProceso = tareas.filter(t => t.estado === "en proceso").length;
    const pendientes = tareas.filter(t => t.estado === "pendiente").length;

    const cumplimiento = total === 0 ? 0 : Math.round((completadas / total) * 100);

    res.json({
        total,
        completadas,
        enProceso,
        pendientes,
        cumplimiento
    });
});

app.listen(PORT, () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
});