(function () {
  const rooms = [
    "assets/room-01-living-room.jpg",
    "assets/room-02-bedroom.jpg",
    "assets/room-03-dining-room.jpg",
    "assets/room-04-home-office.jpg",
    "assets/room-05-kitchen.jpg",
    "assets/room-06-media-room.jpg",
    "assets/room-07-entryway.jpg",
    "assets/room-08-laundry.jpg",
    "assets/room-09-shelving.jpg",
    "assets/room-10-garden-lounge.jpg"
  ];

  const messages = [
    "Looking for individual items…",
    "Checking brands and product details…",
    "Separating similar objects…",
    "Building your inventory…",
    "Almost there…"
  ];

  function boot(options) {
    const settings = Object.assign({
      interval: 3600,
      initialCount: 5,
      messageInterval: 4100,
      onFrame: function () {},
      onScenario: function () {}
    }, options || {});

    const state = {
      count: settings.initialCount,
      index: 0,
      messageIndex: 0,
      reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      activeButton: null
    };

    const scenarioButtons = Array.from(document.querySelectorAll("[data-count]"));
    const motionToggle = document.querySelector("[data-motion-toggle]");
    const messageElements = Array.from(document.querySelectorAll("[data-processing-message]"));
    const currentElements = Array.from(document.querySelectorAll("[data-frame-current]"));
    const totalElements = Array.from(document.querySelectorAll("[data-frame-total]"));
    let frameTimer;
    let messageTimer;

    function visibleFrames() {
      return rooms.slice(0, state.count);
    }

    function announceFrame() {
      currentElements.forEach(function (element) {
        element.textContent = String(state.index + 1);
      });
      totalElements.forEach(function (element) {
        element.textContent = String(state.count);
      });
      document.body.dataset.frameCount = String(state.count);
      document.body.dataset.frameIndex = String(state.index);
      settings.onFrame({
        index: state.index,
        count: state.count,
        src: rooms[state.index],
        frames: visibleFrames(),
        reduceMotion: state.reduceMotion
      });
    }

    function nextFrame() {
      state.index = (state.index + 1) % state.count;
      announceFrame();
    }

    function setScenario(count, chosenButton) {
      state.count = count;
      state.index = 0;
      if (chosenButton) state.activeButton = chosenButton;
      scenarioButtons.forEach(function (button) {
        const active = button === state.activeButton;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      settings.onScenario({
        count: state.count,
        frames: visibleFrames(),
        reduceMotion: state.reduceMotion
      });
      announceFrame();
      window.clearInterval(frameTimer);
      frameTimer = window.setInterval(nextFrame, state.reduceMotion ? settings.interval * 2 : settings.interval);
    }

    function nextMessage() {
      state.messageIndex = (state.messageIndex + 1) % messages.length;
      messageElements.forEach(function (element) {
        element.classList.add("is-changing");
        window.setTimeout(function () {
          element.textContent = messages[state.messageIndex];
          element.classList.remove("is-changing");
        }, state.reduceMotion ? 0 : 240);
      });
    }

    function setMotion(reduced) {
      state.reduceMotion = reduced;
      document.body.classList.toggle("reduce-motion", reduced);
      document.body.classList.toggle("full-motion", !reduced);
      if (motionToggle) motionToggle.checked = reduced;
      setScenario(state.count);
    }

    scenarioButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        setScenario(Number(button.dataset.count), button);
      });
    });

    if (motionToggle) {
      motionToggle.checked = state.reduceMotion;
      motionToggle.addEventListener("change", function () {
        setMotion(motionToggle.checked);
      });
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "1") setScenario(1, scenarioButtons.find(function (button) { return Number(button.dataset.count) === 1; }));
      if (event.key === "5") setScenario(5, scenarioButtons.find(function (button) { return Number(button.dataset.count) === 5; }));
      if (event.key === "0") setScenario(10, scenarioButtons.find(function (button) { return Number(button.dataset.count) === 10; }));
    });

    state.activeButton = scenarioButtons.find(function (button) {
      return button.classList.contains("is-active");
    }) || scenarioButtons.find(function (button) {
      return Number(button.dataset.count) === settings.initialCount;
    }) || scenarioButtons[0];

    messageTimer = window.setInterval(nextMessage, state.reduceMotion ? settings.messageInterval * 1.6 : settings.messageInterval);
    setMotion(state.reduceMotion);

    return {
      rooms: rooms,
      messages: messages,
      state: state,
      setScenario: setScenario,
      nextFrame: nextFrame,
      destroy: function () {
        window.clearInterval(frameTimer);
        window.clearInterval(messageTimer);
      }
    };
  }

  window.CoverlyPrototype = {
    boot: boot,
    rooms: rooms,
    messages: messages
  };
}());
