const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const archivoTareas = "tareas.json";

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

let tareas = [];

if (fs.existsSync(archivoTareas)) {
    try {
        const datos = fs.readFileSync(archivoTareas, "utf8");
        tareas = JSON.parse(datos);
    } catch (error) {
        tareas = [];
    }
}

function guardarTareas() {
    fs.writeFileSync(archivoTareas, JSON.stringify(tareas, null, 2));
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/tareas", (req, res) => {
    res.json(tareas);
});

app.post("/tareas", (req, res) => {
    const nuevaTarea = {
        id: Date.now(),
        titulo: req.body.titulo,
        prioridad: req.body.prioridad || "media",
        fechaLimite: req.body.fechaLimite || "",
        estado: "pendiente",
        fechaCreacion: new Date().toISOString()
    };

    tareas.push(nuevaTarea);
    guardarTareas();

    res.json(nuevaTarea);
});

app.put("/tareas/:id/completar", (req, res) => {
    const id = Number(req.params.id);
    const tarea = tareas.find(t => t.id === id);

    if (!tarea) {
        return res.status(404).json({ mensaje: "No encontrada" });
    }

    tarea.estado = "completada";
    guardarTareas();

    res.json(tarea);
});

app.delete("/tareas/:id", (req, res) => {
    const id = Number(req.params.id);

    tareas = tareas.filter(t => t.id !== id);
    guardarTareas();

    res.json({ mensaje: "Eliminada" });
});

app.get("/cumplimiento", (req, res) => {
    const total = tareas.length;
    const completadas = tareas.filter(t => t.estado === "completada").length;
    const pendientes = total - completadas;
    const cumplimiento = total === 0 ? 0 : Math.round((completadas / total) * 100);

    res.json({
        total,
        completadas,
        pendientes,
        cumplimiento
    });
});

app.listen(PORT, () => {
    console.log(`Servidor iniciado en http://localhost:${PORT}`);
});