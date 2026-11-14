import "./PanelIzquierdo.css";

export default function PanelIzquierdo() {
  return (
    <>
      <section className="seccion seccion-ruta">
        <div className="campo-ruta">
          <label htmlFor="ruta-inicio">
            <span className="punto punto-inicio" />
            Inicio
          </label>
          <input id="ruta-inicio" type="text" placeholder="Punto de partida" />
        </div>

        <div className="campo-ruta">
          <label htmlFor="ruta-fin">
            <span className="punto punto-fin" />
            Fin
          </label>
          <input id="ruta-fin" type="text" placeholder="Punto de llegada" />
        </div>
      </section>

      <section className="seccion" />
      <section className="seccion" />
    </>
  );
}