module.exports = async (req, res) => {
    // Solo permitir método POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    try {
        const payload = req.body || {};
        const { file, data, minify = false } = payload;
        
        if (!file || !data) {
            return res.status(400).json({ error: 'Faltan parámetros de archivo o datos' });
        }

        let githubFilePath = file;
        if (file !== 'admin-history.json') {
            githubFilePath = `api/data-private/${file}`;
        }


        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        const REPO = 'JotaEme29/ComparadorReact';
        const BRANCH = 'main';

        if (!GITHUB_TOKEN) {
            return res.status(500).json({ error: 'Configuración del servidor incompleta (falta GITHUB_TOKEN)' });
        }

        // Obtener el SHA actual del archivo
        const getUrl = `https://api.github.com/repos/${REPO}/contents/${githubFilePath}?ref=${BRANCH}`;
        const getResponse = await fetch(getUrl, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        let sha = null;
        if (getResponse.ok) {
            const fileData = await getResponse.json();
            sha = fileData.sha;
        }

        // Preparar el nuevo contenido
        const jsonString = minify ? JSON.stringify(data) : JSON.stringify(data, null, 2);
        // Base64 encoding compatible with Node.js
        const content = Buffer.from(jsonString, 'utf8').toString('base64');

        // Hacer el commit en GitHub
        const putUrl = `https://api.github.com/repos/${REPO}/contents/${githubFilePath}`;
        const body = {
            message: `Actualización automática de ${file} vía Panel Admin`,
            content: content,
            branch: BRANCH
        };

        if (sha) {
            body.sha = sha;
        }

        const putResponse = await fetch(putUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!putResponse.ok) {
            const err = await putResponse.json();
            throw new Error(err.message || 'Error al guardar en GitHub');
        }

        res.status(200).json({ ok: true, message: 'Guardado exitosamente' });

    } catch (err) {
        console.error('Error in save-data.js:', err);
        res.status(500).json({ error: 'Error del servidor: ' + err.message });
    }
};
