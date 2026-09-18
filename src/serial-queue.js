export class SerialQueue {
  #tail = Promise.resolve();
  #pending = 0;

  get pending() {
    return this.#pending;
  }

  async run(operation) {
    this.#pending += 1;
    const previous = this.#tail;
    let release;
    this.#tail = new Promise((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      this.#pending -= 1;
      release();
    }
  }
}
