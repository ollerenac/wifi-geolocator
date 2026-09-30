# Windows 10: instalación y primera medición con B210

## Alcance y estado

Es viable ejecutar el colector nativamente en **Windows 10 de 64 bits** con
Radioconda, GNU Radio, gr-ieee802-11 y UHD. Radioconda publica un instalador
Windows y los paquetes necesarios; el B210 necesita un controlador USB
compatible. No hace falta compilar gr-ieee802-11 para este procedimiento.

La recepción real está verificada en Linux: UNI_LIBRE_H produjo 287 beacons
del BSSID objetivo en 30 segundos. **La captura física en Windows 10 aún debe
validarse en la laptop de destino.** Las pruebas de software y una instalación
correcta no garantizan rendimiento sostenido a 20 MS/s. El proyecto conserva
los avisos de pérdida de muestras y no da por recibidas redes no decodificadas.

El colector registra potencia relativa `ltf_power_dbfs`. `rssi_dbm` permanece
vacío sin calibración medida. Demo-1 todavía exige dBm para sus estimaciones;
la portabilidad no incorpora la integración pendiente de modelos relativos.

Fuentes oficiales:

- [Radioconda: instalación, Windows y dispositivos UHD](https://github.com/radioconda/radioconda-installer).
- [Radioconda 2025.03.14 y paquetes publicados](https://github.com/radioconda/radioconda-installer/releases/tag/2025.03.14).
- [Ettus: B210](https://files.ettus.com/manual/page_usrp_b200.html) y
  [controlador USB para Windows](https://files.ettus.com/manual/page_transport.html#transport_usb_installwin).

## 1. Preparar y clonar

Necesitas Windows 10 x64, un puerto/cable USB 3 adecuado, el B210 y la antena
conectada al puerto utilizado por el experimento. El receptor de este proyecto
utiliza una sola cadena a 20 MS/s. Emplea recepción nativa de Windows para esta
primera validación; no se necesita una capa adicional de USB en WSL.

Instala [Git for Windows](https://git-scm.com/download/win). Clona el
[repositorio público del proyecto](https://github.com/ollerenac/wifi-geolocator):

```cmd
git clone https://github.com/ollerenac/wifi-geolocator.git
cd wifi-geolocator
git rev-parse HEAD
```

Conserva el identificador del commit con los registros de la campaña. El
repositorio es público y puedes clonarlo sin iniciar sesión en GitHub.
No se incluyen contraseñas de AP ni se necesitan para recibir sus beacons.

## 2. Instalar la distribución fijada

Descarga el [instalador Windows x64 de Radioconda 2025.03.14](https://github.com/radioconda/radioconda-installer/releases/download/2025.03.14/radioconda-2025.03.14-Windows-x86_64.exe).
El proyecto fija esta versión para mantener una base comparable al entorno
Linux usado en los ensayos; no utiliza un enlace móvil a la última versión.

Su SHA-256 publicado es:

```text
d64c316df6f5e76d9f46eaf5e1409aa5fc633e125f5a7d49e8931fa6453b2fee
```

Puedes verificar el archivo descargado desde CMD:

```cmd
certutil -hashfile radioconda-2025.03.14-Windows-x86_64.exe SHA256
```

Instala para tu usuario y conserva el acceso directo **Radioconda Prompt**.
Desde ese terminal, entra en la carpeta del clon. Todos los comandos siguientes
usan el Python del entorno activo: escribe `python`, no el lanzador `py` que
podría seleccionar otro Python del sistema.

```cmd
where python
where uhd_find_devices
```

Ambos deben corresponder a la misma instalación/entorno Radioconda. La base
publicada incluye Python 3.12.9, GNU Radio 3.10.12.0, UHD 4.8.0.0 y
gr-ieee802-11 `0.0.0.20250304.dev+g761bdd9`. No instales una segunda pila
UHD/GNU Radio ni intentes sustituir las bibliotecas nativas mediante pip.

Opcionalmente, para usar un entorno separado con **los paquetes exactos** del
mismo release, desde Radioconda Prompt ejecuta:

```cmd
conda create -n wifi-geolocator-radio --file environments\radioconda-2025.03.14-win-64.lock
conda activate wifi-geolocator-radio
```

Este archivo es específico de Windows x64; no se usa en Linux. Conserva versiones,
builds y hashes del lock oficial. Se normalizaron las URL públicas de los
canales para quitar segmentos de autenticación, y los finales de línea.
Su procedencia y hashes están en [el manifiesto del entorno](../environments/radioconda-2025.03.14-win-64.json).

## 3. Comprobar software sin abrir el B210

Desde la raíz del clon y con el entorno activo:

```cmd
mkdir reports
python check_setup.py --output reports\setup-windows-001.json
echo %ERRORLEVEL%
python b210_wifi_collector.py --self-test
echo %ERRORLEVEL%
```

La comprobación debe devolver 0 y `"ok":true`. Revisa `python_executable`,
`environment_prefix`, imports/APIs y el archivo de referencia PHY. En este
release de Windows está bajo
`Library\share\gnuradio\examples\ieee802_11\wifi_phy_hier.grc` dentro del
entorno; el proyecto también reconoce la distribución Linux y otras rutas
publicadas. No hay rutas de una cuenta Linux fijadas en esta búsqueda.

La segunda orden genera y decodifica señales en memoria. Deben aparecer los
mensajes PASS de identidad, potencia, escalado, rechazo CRC y sincronización.
**No abre hardware ni emite RF.** Si falla, resuelve primero la instalación.
Importar correctamente las dependencias no sustituye esta prueba del receptor.
Los informes usan nombres nuevos y no sobrescriben archivos anteriores.

## 4. Preparar USB, imágenes y descubrir el B210

Desde el mismo entorno descarga las imágenes compatibles:

```cmd
uhd_images_downloader
```

Conecta el B210 al puerto USB 3 y revisa el Administrador de dispositivos.
Si falta un controlador USB compatible, sigue el procedimiento de Ettus para
instalar el driver del B200/B210. Radioconda también documenta WinUSB mediante
[Zadig](https://zadig.akeo.ie/) como alternativa: selecciona el dispositivo
Ettus correcto, verificando su identificación USB; no otro periférico.
Instalar el controlador puede requerir permisos de administrador. El colector
se ejecuta desde el entorno de usuario.

Comprueba, cambiando KUDOS por el serial real si utilizas otro B210:

```cmd
uhd_find_devices
uhd_usrp_probe --args type=b200,serial=KUDOS
```

El dispositivo debe aparecer y el probe debe completar sus comprobaciones.
Verifica que anuncia USB 3. Si no aparece, revisa driver/cable/puerto, imágenes
y el entorno activo. Discovery/probe no son todavía una prueba de recepción
de beacons. No copies binarios de otro entorno ni reemplaces firmware por
archivos ajenos al dispositivo y la versión UHD seleccionada.

## 5. Crear el perfil de procesamiento de esta laptop

El perfil VOLK selecciona kernels para la CPU local. No copies el perfil de
otra laptop; tampoco es una calibración de potencia RF.

```cmd
mkdir .radio-profile\volk
volk_profile --path .radio-profile\volk
```

Comprueba que existe `.radio-profile\volk\volk_config` y espera a que termine
el benchmark antes de recibir. `--volk-config-root .radio-profile` utiliza ese
perfil solamente para el proceso y registra su hash. No garantiza cero pérdidas.

## 6. Identificar el objetivo y hacer una captura

Confirma SSID cuando se anuncia, **BSSID**, banda y canal actuales. En Windows
puedes consultar la lista del adaptador Wi-Fi independiente:

```cmd
netsh wlan show networks mode=bssid
```

Esta consulta del adaptador de la laptop es una referencia distinta del SDR;
los nombres pueden proceder de su caché. Un porcentaje de señal de Windows
no debe escribirse como RSSI en dBm del B210. El colector SDR solo recibe y no
usa `netsh`, `nmcli` ni una asociación con el AP.
[Microsoft documenta estas consultas WLAN](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netsh-wlan).

Para el AP previamente verificado en el laboratorio, con la antena en RF A
RX2, el ejemplo es una sola línea de CMD:

```cmd
mkdir captures
python b210_wifi_collector.py --serial KUDOS --station P1 --output captures\P1-run-001.csv --capture-id P1-run-001 --band 5 --channels 149 --seconds-per-channel 60 --gain 45 --rx-channel 0 --antenna RX2 --antenna-id field-omni-A --bssid C0:3F:DD:06:35:F0 --volk-config-root .radio-profile
```

Sustituye serial, BSSID, canal, puerto y antenna-id por los del experimento
real. El AP de la universidad solo estará disponible donde se recibe ese AP;
clonar el proyecto no hace que aparezca en otra ubicación. `antenna-id` debe
describir el montaje real, no una antena distinta. Usa un nombre de archivo
y capture-id nuevos en cada repetición.

El BSSID permite seleccionar beacons con nombre oculto, como los del AP
UNI_LIBRE_H verificado. No se rellena el nombre a partir de una suposición.
`--ssid` y `--bssid` son filtros alternativos; omite ambos para guardar los
metadatos de todos los beacons decodificados en ese canal. La ausencia de
beacons no demuestra ausencia de RF: la compatibilidad depende de la modulación
y la recepción. Este decodificador admite OFDM legado a/g/p.

## 7. Revisar y conservar los resultados

La captura produce **CSV y su manifiesto `.csv.json`**. Revisa:

- `status=complete`, BSSID/frecuencia y muestras guardadas.
- Puerto, tasa, ganancia fija, AGC, antenna-id y perfil usados realmente.
- Tiempo programado y muestras entregadas, clipping y eventos UHD.
- `ltf_power_dbfs`, con `rssi_dbm` vacío cuando no hay calibración medida.

No interpretes muchos beacons como garantía de independencia estadística,
ni una cobertura de muestras próxima al 100% como ausencia de pérdidas.
Un overflow o un proceso terminado inesperadamente exige revisar esa prueba.
El colector no puede corregir una terminación nativa; un manifiesto incompleto
debe conservarse como tal, sin etiquetarlo manualmente como exitoso.

Para cada punto P1,P2,P3,P4 registra por separado GPS y precisión en metros,
y mantén antena/ganancia/altura/orientación constantes. El station-id enlaza
la posición con su captura. Moverse exige otro station-id. Conserva los dos
archivos de captura y el informe de instalación con una copia de respaldo;
`captures/`, `reports/` y `.radio-profile/` están excluidos de Git.

## 8. Abrir el demo y criterio de aceptación

```cmd
python -m http.server 8765 --bind 127.0.0.1
```

Abre `http://127.0.0.1:8765/demo-1/`. Usa primero el ejemplo simulado para
comprobar la interfaz. El navegador y el servidor local son portables; Node.js
no es necesario para ejecutar el demo. Las capturas relativas del B210 todavía
no entran en su contrato dBm, como se explica al inicio.

La laptop queda validada para **adquisición** cuando pasan la comprobación del
entorno, la prueba de señales generadas, discovery/probe y una captura con
beacons del BSSID esperado y calidad revisada. Debe quedar registrado cualquier
overflow; no se promete equivalencia de rendimiento entre laptops. Una campaña
GPS/calibración aparte validará la estimación de ubicación.

## Qué se ha verificado al preparar esta guía

- El artefacto oficial Windows de gr-ieee802-11 coincide con el hash del lock;
  su estructura contiene el PHY en la ruta Windows indicada.
- La búsqueda del PHY cubre layouts Linux/Windows y sus pruebas pasan.
- En Linux pasan 38 pruebas Python, 12 del demo original y 14 de demo-1;
  la integración con IQ generado y la comprobación del entorno pasan.
- Ejecutar la comprobación con un Python sin las bibliotecas SDR da fallo
  explícito, en lugar de declarar que está listo.
- La recepción física en Windows 10 sigue pendiente. Ningún resultado Linux
  se presenta como una validación ejecutada en Windows.
