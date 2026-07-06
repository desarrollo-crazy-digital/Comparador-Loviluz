const fs = require('fs');
const path = require('path');

// Allowlist de archivos que se pueden leer por motivos de seguridad
const ALLOWED_FILES = {
    'tarifas.v2.json': true,
    'tarifas-gas.v2.json': true,
    'comisiones.json': true,
    'comerciales.json': true,
    'comerciales.info.json': true,
    'comerciales.meta.json': true,
    'ajustes.json': true
};

module.exports = (req, res) => {
    try {
        const file = req.query.file;
        
        if (!file || !ALLOWED_FILES[file]) {
            return res.status(403).json({ error: 'Archivo no permitido o no especificado' });
        }

        const filePath = path.join(__dirname, 'data-private', file);
        
        if (!fs.existsSync(filePath)) {
            // Si es un archivo que podría no existir inicialmente (ej. ajustes), devolver {}
            // En este caso, comerciales.info.json podría no existir en algunos entornos viejos
            if (file === 'comerciales.info.json' || file === 'ajustes.json') {
                 res.setHeader('Content-Type', 'application/json');
                 return res.status(200).send('{}');
            }
            return res.status(404).json({ error: 'Archivo no encontrado' });
        }

        const json = fs.readFileSync(filePath, 'utf8');
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(json);
        
    } catch (err) {
        console.error('Error in get-data.js:', err);
        res.status(500).json({ error: 'No se pudo cargar la información requerida' });
    }
};
