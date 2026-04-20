# agents.md

## Objetivo del proyecto
Crear una extensión de navegador para exportar chats de LLM a:
- `txt` en formato IRC:
  - `<Human> texto...`
  - `<(IA.Name)> texto...`
- `html`
- `mht`

## Reglas de implementación
1. Comentar el código de forma amplia y clara en todos los módulos.
2. Mantener arquitectura modular por proveedor (cada LLM con:
   - detector de URL,
   - detector de chat,
   - extractor propio de mensajes).
3. Mantener un postprocesado global común para todos los proveedores, gobernado por settings persistentes.
4. Priorizar extracción de texto limpio y robusto (si no se reconoce una estructura, intentar rescatar texto sin arrastrar basura HTML).
5. Mantener panel de configuración persistente para:
   - nombre visible del humano,
   - nombre IA por proveedor o personalizado,
   - tratamiento de negritas/itálicas (limpio o Markdown),
   - formato de quotes y separadores (Markdown o tabular),
   - tratamiento de media/no-texto (ignorar, indicar, conservar para MHT).
6. Añadir botón de exportación del chat actual cuando se detecte una conversación activa.
7. Diseñar todo pensando en ampliación posterior (DeepSeek, Grok, Claude, Gemini, etc.).

## Flujo esperado para añadir un nuevo proveedor
1. El usuario pasa extracto HTML de la web del proveedor.
2. Pedir al usuario la URL exacta (dominio/patrón) donde debe activarse la extensión para ese proveedor.
3. Se buscan los selectores más simples y estables para:
   - identificar mensajes del humano,
   - identificar mensajes de la IA,
   - recuperar `innerText`/contenido útil.
4. Se implementa un nuevo adaptador en `src/providers/`.
5. El adaptador entrega mensajes normalizados al postprocesado global.
6. Exportadores no deben depender de detalles concretos del proveedor.

## Estado base actual
- Proveedor implementado: ChatGPT.
- Estructura preparada para incorporar más LLM sin reescribir exportadores ni settings.
