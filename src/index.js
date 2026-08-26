export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/pilas") {
      if (request.method !== "GET") {
        return respuestaJson(
          {
            error: "Método no permitido."
          },
          405,
          {
            Allow: "GET"
          }
        );
      }

      if (!env.PILAS_JSON_URL) {
        return respuestaJson(
          {
            error:
              "No existe el Secret PILAS_JSON_URL."
          },
          500
        );
      }

      try {
        const separador =
          env.PILAS_JSON_URL.includes("?")
            ? "&"
            : "?";

        const urlDropbox =
          `${env.PILAS_JSON_URL}`
          + `${separador}`
          + `t=${Date.now()}`;

        const respuesta = await fetch(
          urlDropbox,
          {
            method: "GET",

            headers: {
              Accept: "application/json"
            },

            cf: {
              cacheTtl: 0,
              cacheEverything: false
            }
          }
        );

        if (!respuesta.ok) {
          return respuestaJson(
            {
              error:
                "No se pudo leer "
                + "PilasEnProceso.json.",

              estado_origen:
                respuesta.status
            },
            502
          );
        }

        const texto =
          await respuesta.text();

        try {
          JSON.parse(texto);
        } catch {
          return respuestaJson(
            {
              error:
                "El origen no devolvió "
                + "un JSON válido."
            },
            502
          );
        }

        return new Response(
          texto,
          {
            status: 200,

            headers: {
              "Content-Type":
                "application/json; charset=utf-8",

              "Cache-Control":
                "no-store, no-cache, must-revalidate",

              "X-Content-Type-Options":
                "nosniff"
            }
          }
        );

      } catch (error) {
        return respuestaJson(
          {
            error:
              "Error consultando "
              + "el origen de datos.",

            detalle:
              error instanceof Error
                ? error.message
                : String(error)
          },
          500
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};


function respuestaJson(
  contenido,
  estado,
  encabezados = {}
) {
  return new Response(
    JSON.stringify(contenido),
    {
      status: estado,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store",

        "X-Content-Type-Options":
          "nosniff",

        ...encabezados
      }
    }
  );
}
