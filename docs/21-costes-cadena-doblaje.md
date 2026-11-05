# 21. Coste de la propuesta Deepgram + DeepL + Cartesia

27 de octubre de 2026. Revisión de la propuesta aportada por el usuario antes de
elegir o cambiar integración. No se compraron planes, crearon claves ni ejecutaron
inferencias durante esta comprobación.

La cadena es técnicamente planteable: ASR incremental → traducción de texto → TTS
en streaming. El presupuesto de **1000 minutos por $5** no está respaldado por los
planes consultados. Tampoco se ha establecido una latencia completa inferior a
600 ms; la cifra rápida de un componente no mide el recorrido de los tres.

## Unidades y supuestos

La estimación de ejemplo usa 1000 minutos de audio original, una traducción de
destino y aproximadamente 1000 minutos de voz sintetizada. Para TTS se aplica la
orientación publicada de Cartesia de 750–800 créditos por minuto generado, con
1 crédito por carácter: **750 000–800 000 caracteres de salida**. La proporción
entre duración original y traducción puede variar; el silencio no genera la misma
cantidad de texto que una conversación continua.
[Unidades de Cartesia](https://www.cartesia.ai/pricing).

DeepL factura texto **de origen**, no el número de caracteres sintetizados. Para
ilustrar su cuota se usa por separado una hipótesis de 750 caracteres originales
por minuto: 750 000 caracteres en 1000 minutos. No es una medición del contenido
de Brivany. Los textos reenviados para corregir parciales se facturan otra vez y
pueden multiplicar el consumo. El parámetro de contexto de DeepL no se traduce ni
se factura como texto, según su referencia.
[Conteo](https://support.deepl.com/hc/en-us/articles/360020685720-Usage-count-and-billing-in-DeepL-API),
[contexto y caracteres facturados](https://developers.deepl.com/api-reference/translate/request-translation).

## Cartesia: $5 cubre aproximadamente 133 minutos TTS

| Plan/condición | Precio publicado | Capacidad o exceso |
|---|---|---|
| Free | $0/mes | 20K créditos; aproximadamente 27 minutos TTS |
| Pro | $5/mes | 100K créditos; aproximadamente 133 minutos TTS |
| Pro con overage activado | $5 base + $65/M créditos adicionales | Si se desactiva overage, las nuevas peticiones se bloquean al agotarse el saldo |
| Startup | $49/mes | 1.25M créditos; suficiente para el escenario 750–800K si solo se gastan en TTS |

Fuente de planes, unidades y política de exceso:
[Cartesia Pricing](https://www.cartesia.ai/pricing). El saldo de modelos puede
emplearse también en STT; gastar parte en STT reduce lo disponible para TTS. Los
dólares para Managed Agents pertenecen a otra bolsa y no añaden caracteres TTS.

Para 1000 minutos TTS en un mes, sin créditos acumulados:

- 750K créditos: Pro con exceso = $5 + (650K × $65/M) = **$47.25**.
- 800K créditos: Pro con exceso = $5 + (700K × $65/M) = **$50.50**.
- Startup cubre ambos escenarios por **$49**. Empieza a resultar inferior al Pro
  con exceso por encima de aproximadamente 776 923 caracteres/mes.

Así, el componente TTS del ejemplo cuesta aproximadamente **$47.25–$49** usando
la opción mensual menos costosa entre esas dos, no $5. La oferta de créditos
gratuitos puede servir para una demostración breve, pero no convierte el consumo
recurrente de 1000 minutos en gratuito. Impuestos, otras funciones, rollover y el
plan efectivo de la cuenta pueden cambiar el importe.

## Deepgram: precio de streaming y oferta inicial

La página consultada distingue claramente **Streaming** y **Pre-Recorded**:

| Nova-3, Pay As You Go | Streaming promocional actual | Streaming regular publicado | 1000 minutos al precio actual |
|---|---|---|---|
| Monolingual | $0.0048/min | $0.0077/min | $4.80 |
| Multilingual | $0.0058/min | $0.0092/min | $5.80 |

$0.0043/min corresponde a Nova-3 monolingual **pregrabado**, no a la ruta WS de
streaming de este caso. Las tarifas de streaming se identifican como promoción
temporal. Add-ons como keyterms o redacción añaden coste y no están incluidos en
la estimación. [Tarifas oficiales](https://deepgram.com/pricing).

La oferta pública es **$200 de crédito inicial**, pendiente de comprobar en la
cuenta. Si se dedicara entero a un solo modelo, sin add-ons, equivaldría por simple
división a aproximadamente 694 horas monolinguales o 575 multilingües con las
tarifas promocionales anteriores. No son horas de doblaje integral, no se renuevan
mensualmente por esa afirmación y no cubren DeepL ni Cartesia. El cálculo es una
equivalencia teórica, no saldo acreditado. [Oferta y precios](https://deepgram.com/pricing).

## DeepL: distinguir planes nuevos y anteriores

La página oficial de planes indica que **API Free y API Pro ya no pueden
contratarse**. API Free existente conserva la referencia de 500 000 caracteres por
mes. Para nuevas altas, API Developer ofrece **1 000 000 de caracteres en total**,
sin renovación al agotarse. API Growth incluye cuotas mensuales/anuales y cobra
excesos; su precio efectivo debe verificarse para la región y cuenta antes de
presupuestarlo. La suscripción web Translator es un producto distinto de la API.
[Planes oficiales](https://support.deepl.com/hc/en-us/articles/360021200939-DeepL-API-plans).

Con la hipótesis ilustrativa de 750 caracteres originales/minuto:

- API Free anterior: 500K cubren unos **667 minutos/mes**. El escenario de 1000
  minutos produce 750K y supera la cuota.
- API Developer nuevo: 1M total cubre unos **1333 minutos una sola vez**, antes de
  alcanzar ese límite, si no hay consumo previo ni reenvíos.
- Un servicio recurrente necesita medir caracteres y cotizar el plan de pago;
  no se asigna coste cero indefinido a esta etapa.

Las páginas consultadas no permitieron fijar una tarifa Growth inequívoca en USD
para esta cuenta. Por ello se conserva como coste pendiente, en vez de reutilizar
un precio antiguo sin verificar.
[Facturación y cuotas](https://support.deepl.com/hc/en-us/articles/360020685720-Usage-count-and-billing-in-DeepL-API).

## Comparación económica del ejemplo de 1000 minutos

| Ruta | Importe aproximado antes de impuestos | Qué falta o condiciona el resultado |
|---|---|---|
| Deepgram + Cartesia después del crédito Deepgram, con cuota DeepL aún disponible | **$52.05–$54.80** | $47.25–$49 TTS más $4.80–$5.80 STT; traducción solo a cero mientras quede cuota efectiva |
| Misma cadena mientras quede crédito inicial Deepgram y cuota DeepL | **$47.25–$49** | El crédito cubre STT; los planes y voces siguen sujetos a sus condiciones |
| Palabra S2S, referencia $0.04/min | **$40** | Referencia de 1000 minutos facturables; verificar tiempo metrado real, cola y saldo |

Estas cuentas son derivaciones de tarifas públicas y supuestos de texto/duración,
no facturas ni cotizaciones. La cadena puede tener ventajas de control y voz,
pero esta muestra **no demuestra que sea más barata** que Palabra. Un volumen
menor, créditos acumulados, otra proporción de audio o un precio negociado cambia
la comparación. [Palabra Pricing](https://www.palabra.ai/pricing),
[Cartesia](https://www.cartesia.ai/pricing), [Deepgram](https://deepgram.com/pricing).

## Latencia: falta medir el recorrido completo

Cartesia anuncia primer audio/modelo inferior a 90 ms para Sonic. Esa cifra
describe TTS después de disponer de texto. Antes faltan audio suficiente para
reconocer, estabilización del ASR, decisión de segmentación, traducción, red y
programación del reproductor. No existe una suma válida de cifras comerciales
con condiciones diferentes que certifique el máximo del producto.
[Sonic](https://www.cartesia.ai/sonic).

Deepgram permite parciales y finales; `endpointing=300` significa esperar una
pausa de 300 ms, no una inferencia de 300 ms. Traducir y pronunciar un parcial
inestable reduce espera aparente, pero una corrección posterior no puede borrar
audio ya oído. La API de texto DeepL recibe peticiones por fragmentos, con una
respuesta por petición; el diseño necesita controlar contexto, duplicados y
revisiones. [Endpointing e interim](https://developers.deepgram.com/docs/understand-endpointing-interim-results),
[traducción de texto](https://developers.deepl.com/api-reference/translate/request-translation).

Para elegir esta cadena se necesita primero un presupuesto de prueba breve y una
comparación sobre la misma muestra que responda una pregunta concreta. Mientras
no exista esa evidencia, se conserva como **alternativa investigada**, sin cambiar
proveedor automáticamente ni declarar los objetivos de 500 ms de inferencia o
600 ms hasta oír voz como cumplidos.
