export class ColaPilas {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    const body = request.method === "POST"
      ? await request.json().catch(() => ({}))
      : {};

    if (
      url.pathname === "/crear"
      && request.method === "POST"
    ) {
      const predio = limpiar(body.predio);
      const pila = limpiar(body.pila);

      if (
        !predio
        || !pila
        || predio.length > 150
        || pila.length > 40
      ) {
        return json(
          {
            error: "Predio o pila inválidos."
          },
          400
        );
      }

      const clave = clavePila(
        predio,
        pila
      );

      const ordenes =
        await this.state.storage.list({
          prefix: "orden:"
        });

      const activa =
        [...ordenes.values()].find(
          orden =>
            orden.clave === clave
            && [
              "PENDIENTE",
              "EJECUTANDO"
            ].includes(orden.estado)
        );

      if (activa) {
        return json(
          {
            orden: publica(activa),
            repetida: true
          },
          200
        );
      }

      const ahora =
        new Date().toISOString();

      const orden = {
        id: crypto.randomUUID(),
        clave,
        accion: "CERRAR_PILA",
        predio,
        pila,
        estado: "PENDIENTE",
        creada: ahora,
        actualizada: ahora,
        intentos: 0,
        detalle: ""
      };

      await this.state.storage.put(
        `orden:${orden.id}`,
        orden
      );

      return json(
        {
          orden: publica(orden),
          repetida: false
        },
        201
      );
    }

    if (
      url.pathname === "/estado"
      && request.method === "GET"
    ) {
      const clave = clavePila(
        limpiar(
          url.searchParams.get("predio")
        ),
        limpiar(
          url.searchParams.get("pila")
        )
      );

      const ordenes =
        await this.state.storage.list({
          prefix: "orden:"
        });

      const coincidencias =
        [...ordenes.values()]
          .filter(
            orden =>
              orden.clave === clave
          )
          .sort(
            (a, b) =>
              b.creada.localeCompare(
                a.creada
              )
          );

      return json({
        orden:
          coincidencias[0]
            ? publica(coincidencias[0])
            : null
      });
    }

    if (
      url.pathname === "/siguiente"
      && request.method === "POST"
    ) {
      const ahoraMs = Date.now();

      const ordenes =
        await this.state.storage.list({
          prefix: "orden:"
        });

      const lista =
        [...ordenes.values()];

      for (const orden of lista) {
        if (
          orden.estado === "EJECUTANDO"
          && orden.lease_hasta
          && Date.parse(
            orden.lease_hasta
          ) < ahoraMs
        ) {
          orden.estado = "PENDIENTE";

          orden.detalle =
            "La ejecución anterior venció; "
            + "se reintentará.";

          orden.actualizada =
            new Date().toISOString();

          delete orden.lease_hasta;

          await this.state.storage.put(
            `orden:${orden.id}`,
            orden
          );
        }
      }

      const pendientes =
        lista
          .filter(
            orden =>
              orden.estado === "PENDIENTE"
          )
          .sort(
            (a, b) =>
              a.creada.localeCompare(
                b.creada
              )
          );

      const orden = pendientes[0];

      if (!orden) {
        return new Response(
          null,
          {
            status: 204
          }
        );
      }

      orden.estado = "EJECUTANDO";

      orden.intentos =
        Number(
          orden.intentos || 0
        ) + 1;

      orden.actualizada =
        new Date().toISOString();

      orden.lease_hasta =
        new Date(
          Date.now()
          + 15 * 60 * 1000
        ).toISOString();

      await this.state.storage.put(
        `orden:${orden.id}`,
        orden
      );

      return json({
        orden
      });
    }

    if (
      url.pathname === "/resultado"
      && request.method === "POST"
    ) {
      const id = limpiar(body.id);
      const clave = `orden:${id}`;

      const orden =
        await this.state.storage.get(
          clave
        );

      if (!orden) {
        return json(
          {
            error: "Orden inexistente."
          },
          404
        );
      }

      orden.estado =
        body.ok === true
          ? "COMPLETADO"
          : "ERROR";

      orden.detalle =
        limpiar(body.detalle)
          .slice(0, 800);

      orden.actualizada =
        new Date().toISOString();

      delete orden.lease_hasta;

      await this.state.storage.put(
        clave,
        orden
      );

      return json({
        orden: publica(orden)
      });
    }

    return json(
      {
        error: "Ruta no encontrada."
      },
      404
    );
  }
}


export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /*
    ============================================================
    API DE PILAS — CONSERVA EL FUNCIONAMIENTO ACTUAL
    ============================================================
    */

    if (url.pathname === "/api/pilas") {
      if (request.method !== "GET") {
        return json(
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
        return json(
          {
            error:
              "No existe el Secret "
              + "PILAS_JSON_URL."
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

        const respuesta =
          await fetch(
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
          return json(
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
          return json(
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
                "application/json; "
                + "charset=utf-8",

              "Cache-Control":
                "no-store, no-cache, "
                + "must-revalidate",

              "X-Content-Type-Options":
                "nosniff"
            }
          }
        );

      } catch (error) {
        return json(
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

    /*
    ============================================================
    COLA DE CIERRE DE PILAS
    ============================================================
    */

    const cola =
      env.COLA_PILAS.get(
        env.COLA_PILAS.idFromName(
          "principal"
        )
      );

    /*
    ============================================================
    CREAR UNA ORDEN DESDE EL DASHBOARD
    ============================================================
    */

    if (
      url.pathname === "/api/ordenes"
      && request.method === "POST"
    ) {
      const pinRecibido =
        request.headers.get(
          "X-Action-Pin"
        );

      if (
        !secretoValido(
          pinRecibido,
          env.ACTION_PIN
        )
      ) {
        return json(
          {
            error: "PIN incorrecto."
          },
          401
        );
      }

      const contenido =
        await request.text();

      return cola.fetch(
        new Request(
          "https://cola/crear",
          {
            method: "POST",
            headers: request.headers,
            body: contenido
          }
        )
      );
    }

    /*
    ============================================================
    CONSULTAR EL ESTADO DE UNA ORDEN
    ============================================================
    */

    if (
      url.pathname
        === "/api/ordenes/estado"
      && request.method === "GET"
    ) {
      const destino =
        new URL(
          "https://cola/estado"
        );

      destino.search = url.search;

      return cola.fetch(destino);
    }

    /*
    ============================================================
    LA PC SOLICITA LA SIGUIENTE ORDEN
    ============================================================
    */

    if (
      url.pathname
        === "/api/agente/siguiente"
      && request.method === "GET"
    ) {
      if (
        !agenteValido(
          request,
          env
        )
      ) {
        return json(
          {
            error: "No autorizado."
          },
          401
        );
      }

      return cola.fetch(
        new Request(
          "https://cola/siguiente",
          {
            method: "POST"
          }
        )
      );
    }

    /*
    ============================================================
    LA PC INFORMA EL RESULTADO
    ============================================================
    */

    if (
      url.pathname
        === "/api/agente/resultado"
      && request.method === "POST"
    ) {
      if (
        !agenteValido(
          request,
          env
        )
      ) {
        return json(
          {
            error: "No autorizado."
          },
          401
        );
      }

      const contenido =
        await request.text();

      return cola.fetch(
        new Request(
          "https://cola/resultado",
          {
            method: "POST",
            headers: request.headers,
            body: contenido
          }
        )
      );
    }

    /*
    ============================================================
    ARCHIVOS ESTÁTICOS
    ============================================================
    */

    return env.ASSETS.fetch(request);
  }
};


/*
============================================================
VALIDAR TOKEN DE LA PC
============================================================
*/

function agenteValido(
  request,
  env
) {
  const cabecera =
    request.headers.get(
      "Authorization"
    ) || "";

  return secretoValido(
    cabecera,
    `Bearer ${env.AGENT_TOKEN || ""}`
  );
}


/*
============================================================
COMPARAR SECRETOS
============================================================
*/

function secretoValido(
  recibido,
  esperado
) {
  if (
    !recibido
    || !esperado
    || recibido.length
      !== esperado.length
  ) {
    return false;
  }

  let diferencia = 0;

  for (
    let i = 0;
    i < recibido.length;
    i += 1
  ) {
    diferencia |=
      recibido.charCodeAt(i)
      ^ esperado.charCodeAt(i);
  }

  return diferencia === 0;
}


/*
============================================================
LIMPIAR TEXTO
============================================================
*/

function limpiar(valor) {
  return String(
    valor ?? ""
  ).trim();
}


/*
============================================================
CLAVE ÚNICA PREDIO + PILA
============================================================
*/

function clavePila(
  predio,
  pila
) {
  const predioNormalizado =
    predio
      .normalize("NFD")
      .replace(
        /[\u0300-\u036f]/g,
        ""
      )
      .toUpperCase();

  return (
    `${predioNormalizado}`
    + "|"
    + `${pila.toUpperCase()}`
  );
}


/*
============================================================
DATOS PÚBLICOS DE LA ORDEN
============================================================
*/

function publica(orden) {
  return {
    id: orden.id,
    predio: orden.predio,
    pila: orden.pila,
    estado: orden.estado,
    creada: orden.creada,
    actualizada: orden.actualizada,
    detalle:
      orden.detalle || ""
  };
}


/*
============================================================
RESPUESTA JSON
============================================================
*/

function json(
  contenido,
  estado = 200,
  encabezados = {}
) {
  return new Response(
    JSON.stringify(contenido),
    {
      status: estado,

      headers: {
        "Content-Type":
          "application/json; "
          + "charset=utf-8",

        "Cache-Control":
          "no-store",

        "X-Content-Type-Options":
          "nosniff",

        ...encabezados
      }
    }
  );
}
