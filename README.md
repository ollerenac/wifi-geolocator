# Wi-Fi Geolocator

A local 2D experiment notebook for plotting Wi-Fi observation stations and
model-compatible AP location regions. Example data is explicitly simulated.
A receive-only B210 prototype now records decoded OFDM beacon metadata and
relative power. A live UNI_LIBRE_H AP yielded 287 beacons in a 30-second test;
its hidden beacon name required BSSID identification. See
[the live results](docs/b210-uni-libre-check.md). RF calibration and ranging
remain unvalidated, and sample-overflow events require further work.

## Run the demo

Clone the [public GitHub repository](https://github.com/ollerenac/wifi-geolocator):

```bash
git clone https://github.com/ollerenac/wifi-geolocator.git
cd wifi-geolocator
```

For acquisition on another laptop, start with the
[Windows 10 installation and first-capture guide](docs/windows-10-setup.md).
It provides a pinned Radioconda Windows environment, USB setup, software
checks and a B210 capture command. Live RF is verified on Linux; Windows10
hardware acceptance remains to be performed on the destination laptop.

From this folder:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Open **http://127.0.0.1:8765/demo-1/** for the multi-AP survey, or
**http://127.0.0.1:8765/demo-0/** for the preserved original single-AP demo.
The original `/demo/` URL still works. No packages, external maps, internet
connection, accounts or build step are required. Use HTTP rather than opening
the HTML file directly, because the application uses JavaScript modules.

## Demo-1: stations and multi-AP captures

- Enter station GPS positions manually or import station CSV.
- Import repeated, timestamped BSSID-specific RSSI samples for each station.
- See an AP × station coverage table, including missing/brief detections.
- Assess count, observed time span, occupied bins, spread and station geometry.
- Keep identical SSIDs separate by BSSID/frequency and apply separate AP models.
- Automatically arrange local coordinates from station positions.
- Plot feasible APs individually or as a gallery; retain insufficient data reasons.
- Add independent known AP GPS references and export survey/results/plots.

### Guía rápida: mediciones P1–P4 con el B210

Desde la raíz del proyecto, inicia el servidor con el comando anterior y abre
`http://127.0.0.1:8765/demo-1/`. La página comienza con datos **simulados**:
selecciona un AP en la tabla para inspeccionar sus estaciones y el gráfico.
Pulsa **New field survey** antes de introducir mediciones propias.

En cada posición fija P1, P2, P3 y P4, anota latitud, longitud WGS84 y precisión
GPS en metros. Ingresa cada estación en el formulario o prepara un CSV con las
columnas `station_id,latitude,longitude,gps_accuracy_m,notes`. Usa el mismo ID
en su captura; cambiar de posición requiere un ID nuevo. Conserva también el
BSSID y canal actuales del AP controlado como referencia independiente.
Por ejemplo, `stations.csv` puede comenzar así (sustituye las coordenadas y
precisiones de ejemplo por tus mediciones):

```csv
station_id,latitude,longitude,gps_accuracy_m,notes
P1,-12.04629,-77.04267,5,Primera posición
P2,-12.04572,-77.04266,5,Segunda posición
```

En esta laptop Linux, ejecuta las capturas en el entorno **Radioconda** con el
B210 conectado a RF A RX2. Este ejemplo para P1 escucha los canales 149 y 153
de 5 GHz durante 30 segundos por canal; ajusta la lista a los canales que hayas
verificado en el lugar:

```bash
mkdir -p captures
python3 b210_wifi_collector.py \
  --serial KUDOS --station P1 \
  --output captures/P1-run-001.csv --capture-id P1-run-001 \
  --band 5 --channels 149,153 --seconds-per-channel 30 \
  --gain 45 --rx-channel 0 --antenna RX2 \
  --antenna-id telescopic-12to15cm-RFA-RX2
```

Sin `--ssid` ni `--bssid`, el colector guarda los beacons **decodificados** de
todos los AP que alcance a oír en esos canales; no escucha todos los canales a
la vez ni garantiza detectar todos los SSID presentes. Repite el comando en
P2, P3 y P4, cambiando `--station`, `--output` y `--capture-id` por el ID y un
nombre de archivo nuevos. Mantén antena, ganancia, altura y orientación tan
constantes como sea posible. Cada captura crea un CSV y un manifiesto
`.csv.json`; revisa si hubo beacons y eventos de overflow antes de moverte.
Para otra banda o para Windows, sigue las guías enlazadas abajo.
`--station P1` escribe `P1` en la columna `station_id` de cada beacon: **ese ID
asocia la captura con las coordenadas**, no el nombre `P1-run-001.csv`.
`--capture-id` distingue las corridas y debe ser nuevo en cada archivo. Con los
dos canales del ejemplo, 30 segundos por canal son aproximadamente un minuto
por punto, más el tiempo de arranque y cambio de canal. Para un minuto por
canal, usa `--seconds-per-channel 60`.

Una fila CSV representa un beacon. Contiene `station_id`, `bssid`, `ssid`,
`frequency_mhz` y `ltf_power_dbfs`. Agrupa por **station_id + BSSID + frecuencia
+ config_id**, no solo por SSID: varios AP pueden compartir nombre y otros lo
ocultan. Esta orden imprime el número de beacons y la mediana de potencia
relativa por grupo de capturas `P*-run-*.csv`:

```bash
python3 - <<'PY'
import csv
import statistics
from collections import defaultdict
from pathlib import Path

groups = defaultdict(list)
names = {}
for path in Path("captures").glob("P*-run-*.csv"):
    with path.open(newline="") as file:
        for row in csv.DictReader(file):
            key = (row["station_id"], row["bssid"], row["frequency_mhz"], row["config_id"])
            groups[key].append(float(row["ltf_power_dbfs"]))
            names[key] = row["ssid"] or names.get(key, "(oculto)")

for key, values in sorted(groups.items()):
    print(*key[:3], names[key], len(values),
          f"{statistics.median(values):.2f} dBFS", sep=" | ")
PY
```

`ltf_power_dbfs` es potencia relativa **por AP**, no RSSI calibrado en dBm.
Sin una calibración medida y compatible, `rssi_dbm` permanece vacío: **demo-1
rechaza estos CSV del B210 al importarlos** y no muestra sus AP ni calcula
regiones a partir de ellos. Puedes conservarlos y usar el resumen anterior para
comparar detección y potencia relativa por punto. Para practicar el gráfico,
usa la simulación inicial. Con capturas compatibles que sí contienen `rssi_dbm`
medido en dBm, importa primero las estaciones y después selecciona **cada CSV**
mediante **Import RSSI capture CSV**. La página no lee automáticamente la carpeta
`captures/`; el manifiesto `.csv.json` se conserva como registro y no se importa
en ese botón. Cada CSV de captura debe medir menos de 1 MB. Revisa cobertura,
calidad y geometría, y guarda la encuesta con **Save survey**.

Read [the demo-1 workflow and file contracts](docs/demo-1-workflow.md).
The offline `prepare_demo1_survey.py` helper joins GPS exports and existing
capture metadata; it does not collect live radio measurements. Read the
[B210 collector procedure and validation limits](docs/b210-collector.md) for
acquisition. Uncalibrated dBFS captures cannot yet enter demo-1's dBm-only
ranging workflow.

## Demo-0: the original single-AP experiment

- Select/deselect stations to compare one, two, three and four observations.
- Compare RSSI rings, directional bearings and the intersection of both.
- Edit station coordinates, GPS accuracy, AP-specific RSSI and optional bearings.
- Fit a simple RSSI model using separate known-distance calibration measurements.
- Start a field session and manually enter or import measurements.
- Save/reload JSON sessions; export CSV metadata or an SVG plot.

Changes stay in browser memory until you save a session. Save before resetting,
starting a new session or refreshing the page. Imported data stays local.

Read [the test methodology and CSV contract](docs/demo-methodology.md) before
using field data. [demo/examples/simulated-session.json](demo/examples/simulated-session.json)
is a complete synthetic example. [demo/examples/simulated-observations.csv](demo/examples/simulated-observations.csv)
illustrates the observation format; importing CSV classifies it as field input,
so these example rows must still be treated as simulated.

## Verify

```bash
node tests/test_demo_geometry.mjs
node tests/test_demo1_survey.mjs
/usr/bin/python3 -m pytest -q
```

The JavaScript tests verify coordinate conversion, calibration, uncertainty
geometry, multi-AP coverage, time-coverage gates, capture associations, import
validation and separation of AP references from estimates. Python tests cover
the B210 probe, offline survey preparation, beacon parsing, relative power,
calibration guards and collector CSV contracts. Run the decoder's hardware-free
integration check separately with `python3 b210_wifi_collector.py --self-test`.
These software tests do not validate RF calibration or field performance.
The existing pytest installation uses system Python; Radioconda remains the
environment for B210 hardware checks.

Before using an acquisition environment, run `python check_setup.py` in its
activated prompt, followed by `python b210_wifi_collector.py --self-test`.
The first checks imports/APIs and portable reference-file lookup without
opening hardware; the second runs generated-IQ decoding. Neither verifies USB
or replaces a live beacon test.

## Existing B210 probe

`b210_wifi_activity.py` receives aggregate signal samples on a selected 2.4 GHz
channel and prints mean power in **dBFS**. It does not identify BSSIDs, produce
AP-specific RSSI in dBm, or calculate a location. Run hardware tests using the
existing Radioconda/UHD environment described in [brainstorm.md](brainstorm.md).

The field design remains passive and metadata-only. See [project.md](project.md)
for the overall scope.
