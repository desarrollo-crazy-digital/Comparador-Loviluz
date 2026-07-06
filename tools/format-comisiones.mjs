import fs from 'fs';
import path from 'path';

const COMISIONES_PATH = path.resolve('api/data-private/comisiones.json');

function compactarComisiones() {
    try {
        const raw = fs.readFileSync(COMISIONES_PATH, 'utf8');
        const obj = JSON.parse(raw);
        let formatted = JSON.stringify(obj, null, 2);
        
        // Replace items inside bloques array. We can match any object that only contains number/null values
        formatted = formatted.replace(
            /\{\s*"desde":\s*([^,]+),\s*"hasta":\s*([^,]+),\s*"comision":\s*([^}\s]+)\s*\}/g, 
            '{ "desde": $1, "hasta": $2, "comision": $3 }'
        );

        fs.writeFileSync(COMISIONES_PATH, formatted);
        console.log('Done compacting comisiones.json');
    } catch (e) {
        console.error(e);
    }
}

compactarComisiones();
